// cross-spawn (not node:child_process) so the `claude` CLI launches on Windows too,
// where it's a `claude.cmd` shim that bare spawn() can't resolve / refuses to run.
import spawn from 'cross-spawn';
import { loadConfig, vaultDir } from './config.js';

// Only one *writing* claude run at a time — process / research / review / home / calsync mutate the
// vault. Read-only runs (chat) are exempt and may run concurrently. (Find no longer spawns claude.)
let writeRunning = false;
export const isRunning = () => writeRunning;

// Read-only kinds: no write lock, and eligible for the Gemini REST fallback (2nd in the chain,
// after Qwen and before DeepSeek). `noteaugment` is here
// too — it now only *generates* the overview text (the server does the actual file insertion), so
// it needs no edit tools and can fall back to Gemini/DeepSeek exactly like the chats.
const READ_ONLY = new Set(['chat', 'notechat', 'noteaugment', 'search']);

// Separator the augment run prints between its placement anchor and the markdown body. Kept rare so
// it won't collide with note content; the server splits on it (see parseAugment + the augment route).
export const AUGMENT_SEP = '<<<INSERT-BELOW>>>';

const ALLOWED = {
  process: [
    'Edit', 'Write', 'Read', 'Bash', 'Glob', 'Grep',
    'mcp__claude_ai_Google_Calendar__create_event',
  ],
  research: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  review: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  home: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  // Read-only advisor: search/read notes + read the calendar. No Write/Edit/Bash on purpose.
  chat: ['Read', 'Glob', 'Grep', 'mcp__claude_ai_Google_Calendar__list_events'],
  // Read-only tutor scoped to one open note. Reads related notes for context; never writes.
  notechat: ['Read', 'Glob', 'Grep'],
  // Augment ONE note: the model only *writes the overview text* (read-only — server inserts it),
  // so it may read related notes for context but never edits anything.
  noteaugment: ['Read', 'Glob', 'Grep'],
  // Semantic "describe what you want" search — greps/reads to find relevant notes, prints a path list.
  search: ['Read', 'Glob', 'Grep'],
  // Pull calendar events into a local cache file. Reads the calendar, writes only .cache/calendar.json.
  calsync: ['Read', 'Write', 'mcp__claude_ai_Google_Calendar__list_events'],
  // Propose a folder tidy-up. Reads structure, writes only the proposal to .cache/autosort.json.
  autosort: ['Read', 'Glob', 'Grep', 'Write'],
};

const PROMPTS = {
  process: () =>
    'Run the process-inbox skill on this vault. This run was launched from the lifeOS app with '
    + 'no interactive user attached: when unsure where something belongs, file it to Captures/ '
    + 'with #needs-filing rather than asking. Give a concise final summary of what you did.',

  research: (cfg, idea) =>
    `You are the "Research an idea" tool in ${cfg.ownerName}'s Obsidian vault, launched from the `
    + 'lifeOS app with no interactive user attached.\n\n'
    + `The idea to research:\n"""\n${idea}\n"""\n\n`
    + 'Do this:\n'
    + '1. Use web search to assess the idea — is it already taken / who are the competitors, is '
    + 'there real demand, and is it technically and commercially feasible?\n'
    + '2. Write ONE well-structured note to `Ideas/<short-kebab-title>.md` with: a one-line '
    + 'summary; a **Verdict** (Promising / Crowded / Hard / Skip) with a confidence; and sections '
    + 'for Demand, Competition (with links), Feasibility, Differentiation, and Next steps. Tag '
    + '`#idea` and link back to [[Ideas]] and [[Personal]].\n'
    + '3. Do NOT touch inbox.md or other existing notes.\n'
    + 'Finish with a concise summary of the verdict and the note path.',

  review: (cfg) =>
    `You are the "Weekly review" tool in ${cfg.ownerName}'s Obsidian vault, launched from lifeOS `
    + '(no interactive user). Today\'s date is in context. Review notes edited in the last 7 days, '
    + 'the TODO/ checklists, and recent Captures. Write a note `Reviews/<YYYY>-W<week>.md` (create '
    + 'it; do not overwrite an existing week) summarizing: what happened, open & overdue tasks, '
    + 'ideas captured, and 3 suggested focuses for next week. Link [[Personal]]. Finish with a '
    + 'concise summary.',

  home: (cfg) =>
    `You are the "Refresh Home note" tool in ${cfg.ownerName}'s vault, launched from lifeOS. `
    + 'Regenerate `Home.md` as a dashboard MOC. First look at the actual top-level folders/hubs that '
    + 'exist in the vault (e.g. [[University]], [[Personal]], [[TODO]], [[Ideas]], plus any others). '
    + 'List each real top-level domain, and under it only its **actual** sub-areas — its real '
    + 'subfolders. Never nest a sibling top-level folder under another domain (e.g. TODO and Ideas are '
    + 'their own domains, not areas of Personal). Also include the most recently edited notes, '
    + 'open/overdue tasks from TODO/, and any notes tagged #needs-filing. Keep it concise and link-rich. '
    + 'Overwrite Home.md only. Finish with a one-line summary.',

  chat: (cfg, messages) => {
    const recent = (messages || []).slice(-8);
    const transcript = recent
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'You'}: ${String(m.text || '').trim()}`)
      .join('\n');
    return `You are ${cfg.ownerName}'s personal assistant with **read-only** access to their Obsidian `
      + 'vault (Read/Glob/Grep) and their Google Calendar (list_events). Today\'s date is in context '
      + `(timezone ${cfg.timezone}).\n\n`
      + 'Help them think and plan: review their day/diaries/tasks, suggest what to focus on, advise how '
      + 'to approach assignments, etc. Ground every answer in what\'s actually in the vault/calendar — '
      + '**grep for the relevant notes first, then read only those**; cite notes as [[wikilinks]]. Be '
      + 'warm, concise and concrete. Preserve the user\'s language(s); never translate.\n'
      + 'IMPORTANT: you are read-only — never create, edit, or delete anything. If they ask you to, '
      + 'tell them to use the relevant tab. Reply in plain Markdown, no preamble.\n\n'
      + `Conversation so far:\n${transcript}\n\nAnswer the latest message.`;
  },

  // Tutor scoped to one open note. Gets the note's path + full content inline so it doesn't
  // even need to read the file, and may Grep/Read *related* notes for extra context.
  notechat: (cfg, notePath, noteContent, messages) => {
    const recent = (messages || []).slice(-8);
    const transcript = recent
      .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'You'}: ${String(m.text || '').trim()}`)
      .join('\n');
    return `You are ${cfg.ownerName}'s study tutor, helping them understand **one specific note** they `
      + `have open in their Obsidian vault. Today's date is in context (timezone ${cfg.timezone}).\n\n`
      + `The open note is \`${notePath}\`. Its full current content is:\n"""\n${noteContent}\n"""\n\n`
      + 'Answer their follow-up questions about this note — explain concepts, work through the math '
      + 'step by step, give intuition and examples. This is often technical/math material (e.g. '
      + 'scientific computing): render all math as LaTeX — inline `$…$`, display `$$…$$` — so it '
      + 'displays properly. You have **read-only** access to the rest of the vault (Read/Glob/Grep): '
      + 'pull in a related note only if it genuinely helps, and cite it as a [[wikilink]]. Be warm, '
      + 'concise and concrete; preserve the user\'s language(s), never translate. You cannot edit the '
      + 'note here — if they want something saved into it, tell them to tap **➕ Add to note**. Reply '
      + `in plain Markdown, no preamble.\n\nConversation so far:\n${transcript}\n\nAnswer the latest message.`;
  },

  // Write an overview of a topic the user felt weak on, to be inserted INTO their open note. The
  // model does NOT edit the file — it returns the section text plus where it belongs; the server
  // inserts it (strictly additive). The note's full content is inlined so it needs no tools.
  noteaugment: (cfg, notePath, noteContent, topic, context) =>
    `You are helping ${cfg.ownerName} revise **one note** in their Obsidian vault (timezone ${cfg.timezone}). `
    + `They were studying it and asked their tutor about a topic they felt weak on, and now want a clear `
    + `overview of that topic added **into the note** for later revision.\n\n`
    + `The note is \`${notePath}\`. Its full current content is:\n"""\n${noteContent}\n"""\n\n`
    + `The topic / question they asked:\n"""\n${topic}\n"""\n`
    + (context ? `\nWhat the tutor told them (use it, but write your own clean overview):\n"""\n${context}\n"""\n` : '')
    + `\nWrite a concise, self-contained overview of that topic: the core idea, key formulas as **LaTeX** `
    + `(inline \`$…$\`, display \`$$…$$\`), and a short worked example or intuition where it helps. Begin it `
    + `with its own \`## \` or \`### \` heading (e.g. \`## Overview — <topic>\`). Match the note's existing `
    + `language and style; keep \`[[wikilinks]]\` title-only.\n\n`
    + `Decide WHERE in the note it best belongs — directly after the existing section it relates to, so it `
    + `sits next to related material (near the top if it relates to an early section, the middle if a middle `
    + `section, the end only if nothing matches).\n\n`
    + `Respond in EXACTLY this format and nothing else — no preamble, no code fences:\n`
    + `• First, ONE line: the exact text of the existing note heading your overview should go immediately `
    + `after (copy it verbatim, including its \`#\` marks) — or \`START\` for the very top of the note, or `
    + `\`END\` for the very end.\n`
    + `• Then a line containing only: ${AUGMENT_SEP}\n`
    + `• Then the markdown of the overview to insert (raw LaTeX, no escaping).`,

  autosort: (cfg) =>
    `You are the "Auto-sort" job in ${cfg.ownerName}'s lifeOS vault, no interactive user. Your job is to `
    + 'PROPOSE a folder tidy-up — you do NOT move anything yourself.\n\n'
    + '1. Read `CLAUDE.md` to learn the MOC domain structure (top-level domains and what belongs under '
    + 'each), then list the vault\'s **top level** (root folders and root-level notes).\n'
    + '2. Find **loose top-level strays** — root folders/notes that, per the MOC, belong under a domain '
    + 'folder (e.g. `TODO`, journal/diary folders, ideas, personal config → under `Personal/`; loose '
    + 'course/club folders → under the university domain). Propose nesting each under the correct domain '
    + 'folder, creating that domain folder if it doesn\'t exist, and **placing the domain\'s hub note '
    + 'inside that folder** (so the graph\'s folder→hub link resolves).\n'
    + '3. **Only group loose top-level strays.** Do NOT reorganize already-nested trees, and NEVER touch '
    + 'infra dirs (`.claude`, `.git`, `.obsidian`, `.inbox-archive`, `.cache`, `attachments`).\n'
    + '4. Write the plan as JSON to `.cache/autosort.json` (create `.cache/` if needed): a single array '
    + '`[{ "src": "<current relative path>", "dest": "<destination folder>", "reason": "<short why>" }]`. '
    + 'Use vault-relative paths with forward slashes. **Write ONLY that file; move nothing.** If nothing '
    + 'needs sorting, write `[]`. Finish with a one-line count of proposed moves.',

  // Semantic vault search: the user describes what they're after in natural language (like searching
  // Google Photos by description). The model greps/reads to find the notes that genuinely match the
  // *intent* — synonyms, related concepts, not just literal keywords — then prints a plain path list.
  search: (cfg, query) =>
    `You are the semantic search engine for ${cfg.ownerName}'s Obsidian vault (read-only: Glob/Grep/Read). `
    + `Today's date is in context (timezone ${cfg.timezone}).\n\n`
    + `The user is looking for notes matching this description:\n"""\n${query}\n"""\n\n`
    + 'Find the notes that best match the *meaning* of that description — think of synonyms, related '
    + 'concepts and topics, not just literal word matches. Glob to see the vault, Grep for candidate '
    + 'terms (try several phrasings), and Read a few promising notes to confirm relevance.\n\n'
    + 'Then output ONLY the results, nothing else — no preamble, no summary, no code fences. One note '
    + 'per line, most relevant first, at most 12 lines, in EXACTLY this format:\n'
    + '`<vault-relative/path/to/note.md> :: <one short line on why it matches>`\n'
    + 'Use real paths that exist in the vault (forward slashes). If nothing matches, output the single '
    + 'line `NONE`.',

  calsync: (cfg) =>
    `You are the "Sync Google Calendar" job in ${cfg.ownerName}'s lifeOS, no interactive user. `
    + 'Today\'s date is in context. Use the Google Calendar `list_events` tool to fetch events from 7 '
    + 'days ago through ~60 days ahead (timezone ' + cfg.timezone + '). Write them as JSON to '
    + '`.cache/calendar.json` (create the `.cache/` folder if needed) — a single JSON array of objects '
    + '`{ "date": "YYYY-MM-DD", "time": "HH:MM" or null, "title": "...", "calendar": "..." }`, sorted by '
    + 'date then time. **Overwrite only that file; touch nothing else in the vault.** Finish with a '
    + 'one-line summary of how many events you wrote.',
};

// Output that means "the primary account is out of capacity" — the only failure we retry on the
// fallback provider. Kept narrow so ordinary errors (bad tool, crash) don't waste a fallback run.
const LIMIT_RE = /usage limit|rate.?limit|limit reached|session limit|spend limit|quota|exhausted|overloaded|too many requests|\b429\b|insufficient|out of credit/i;

// Agentic "console" runs stream their progress to the app's process sheet. We launch these with
// --output-format stream-json so the server can turn each event into a readable progress line
// (instead of claude -p going silent until done). The chats + note-augment are NOT here: they
// consume claude's plain-text output directly. Keyed by kind.
const STREAM_JSON = new Set(['process', 'research', 'review', 'home', 'calsync', 'autosort']);

// Bound MCP startup + per-tool-call time so a flaky MCP server (e.g. the Google Calendar tool over
// Tailscale) can't hang an entire run. Claude proceeds without that tool once the bound elapses.
const MCP_TIMEOUT_MS = '15000';
const MCP_TOOL_TIMEOUT_MS = '30000';

/** Shorten a tool's key argument for a one-line progress entry. */
function toolSummary(name, input) {
  const inp = input || {};
  const short = (s) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 90) + '…' : s; };
  const f = inp.file_path || inp.path || inp.notePath || '';
  switch (name) {
    case 'Read': case 'Edit': case 'Write': case 'NotebookEdit': return `${name} ${short(f)}`;
    case 'Bash': return `Bash: ${short(inp.command)}`;
    case 'Grep': return `Grep ${short(inp.pattern)}`;
    case 'Glob': return `Glob ${short(inp.pattern)}`;
    case 'Skill': return `Skill ${short(inp.command || inp.name)}`;
    default:
      if (name && name.startsWith('mcp__')) return name.split('__').slice(-1)[0].replace(/_/g, ' ');
      return name || 'tool';
  }
}

/**
 * Turn one Claude stream-json event into human-readable console line(s) for the process sheet.
 * Returns an array of { channel, line } ('err' shows red). Defensive — unknown shapes yield [].
 */
function describeStreamEvent(ev) {
  const out = [];
  const push = (line, channel = 'out') => { if (line && String(line).trim()) out.push({ channel, line: String(line) }); };
  if (!ev || typeof ev !== 'object') return out;

  if (ev.type === 'system' && ev.subtype === 'init') {
    // Surface only MCP servers in a bad state (the usual culprit when a run hangs/misbehaves).
    for (const s of (ev.mcp_servers || [])) {
      if (!/^(connected|ready|ok)$/i.test(s.status || '')) push(`  ⚠ mcp · ${s.name}: ${s.status}`, 'err');
    }
    return out;
  }
  if (ev.type === 'rate_limit_event' && ev.rate_limit_info && /reject|exceed|limit/i.test(ev.rate_limit_info.status || ev.rate_limit_info.rateLimitType || '')) {
    push('  ⚠ rate limit hit', 'err');
    return out;
  }
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const b of ev.message.content) {
      if (b.type === 'text') push(b.text);
      else if (b.type === 'tool_use') push(`🔧 ${toolSummary(b.name, b.input)}`);
    }
    return out;
  }
  if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
    for (const b of ev.message.content) {
      if (b.type === 'tool_result' && b.is_error) {
        const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        push(`  ⚠ tool error: ${String(t).slice(0, 200)}`, 'err');
      }
    }
    return out;
  }
  if (ev.type === 'result') {
    push(ev.result, ev.is_error ? 'err' : 'out');
    const bits = [];
    if (ev.num_turns != null) bits.push(`${ev.num_turns} turns`);
    if (ev.duration_ms != null) bits.push(`${Math.round(ev.duration_ms / 1000)}s`);
    if (ev.total_cost_usd) bits.push(`$${Number(ev.total_cost_usd).toFixed(4)}`);
    if (bits.length) push(`— ${bits.join(' · ')}`);
  }
  return out;
}

/**
 * Direct Gemini (Google AI Studio) call — the fallback for the read-only AI **chats** when the
 * primary `claude` run hits a usage limit. Gemini isn't Anthropic-compatible, so we can't route the
 * CLI through it; instead we POST the same self-contained chat prompt to Gemini's REST API and stream
 * the reply back as `out` lines (the exact shape the chat routes already consume). Text in, text out,
 * no tools — which is all a chat needs, since the note's content + conversation are inside the prompt.
 */
async function streamGemini(prompt, onEvent, release) {
  const gem = loadConfig().gemini || {};
  const model = (gem.model || 'gemini-2.5-flash').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  // Re-frame Gemini's token chunks into whole lines (like claude's stdout pump) so the route's
  // per-line newline handling reconstructs the markdown correctly.
  let line = '';
  const emit = (t) => { line += t; const parts = line.split('\n'); line = parts.pop(); for (const p of parts) onEvent('log', { channel: 'out', line: p }); };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gem.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    });
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '');
      release(); onEvent('error', { message: `Gemini fallback failed (HTTP ${resp.status}). ${t.slice(0, 180)}` });
      return;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let sse = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sse += dec.decode(value, { stream: true });
      let nl;
      while ((nl = sse.indexOf('\n')) >= 0) {
        const raw = sse.slice(0, nl).trim(); sse = sse.slice(nl + 1);
        if (!raw.startsWith('data:')) continue;
        const payload = raw.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          if (j.error) { release(); onEvent('error', { message: `Gemini: ${j.error.message || 'error'}` }); return; }
          const txt = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
          if (txt) emit(txt);
        } catch { /* a data line is one complete JSON object; ignore any stray non-JSON */ }
      }
    }
    if (line) onEvent('log', { channel: 'out', line }); // flush trailing partial line
    release();
    onEvent('done', { code: 0, usedFallback: 'gemini' });
  } catch (e) {
    release();
    onEvent('error', { message: 'Gemini fallback error: ' + e.message });
  }
}

/** Compose the `claude -p` argv for one attempt (model is optional → CLI default). */
function buildArgs({ kind, prompt, model, maxTurns }) {
  const args = ['-p', prompt, '--permission-mode', 'acceptEdits'];
  // Agentic runs stream JSON events so the server can show live progress; chats stay plain text.
  if (STREAM_JSON.has(kind)) args.push('--output-format', 'stream-json', '--verbose');
  if (model) args.push('--model', model);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  args.push('--allowedTools', ...(ALLOWED[kind] || ALLOWED.process));
  return args;
}

/**
 * Spawn `claude -p` in the vault and stream stdout/stderr lines to `onEvent`.
 * onEvent(type, data): type ∈ {status, log, done, error}.
 * Picks the per-task model + turn cap from config, and — if a run dies with a usage/rate-limit
 * error — cascades down the configured fallback chain (claude → Qwen → Gemini → DeepSeek), trying
 * the same prompt on each next provider. Qwen + DeepSeek are Anthropic-compatible so they drive the
 * `claude` CLI (any kind); Gemini is REST-only (read-only kinds only: chats + add-to-note, so on
 * write kinds it's skipped and the chain is Qwen → DeepSeek). Returns a kill function.
 */
function spawnClaude({ kind, prompt, forceProvider }, onEvent) {
  const readOnly = READ_ONLY.has(kind);
  if (!readOnly && writeRunning) {
    onEvent('error', { message: 'A run is already in progress.' });
    return () => {};
  }
  if (!readOnly) writeRunning = true;
  const release = () => { if (!readOnly) writeRunning = false; };

  const cfg = loadConfig();
  const cwd = vaultDir(cfg);

  // Ordered fallback chain after the primary `claude` run: Qwen → Gemini → DeepSeek. An
  // Anthropic-compatible provider needs a baseUrl + apiKey (it runs through the CLI with an env
  // override); Gemini needs only an apiKey and is REST-only, so it's offered for read-only kinds
  // (no tools needed) — which includes add-to-note. On write kinds (capture/process etc.) Gemini
  // can't drive the tools, so it's filtered out and the chain there is Qwen → DeepSeek.
  // Unconfigured links are skipped.
  const cli = (c, name) => (c && c.apiKey && c.baseUrl)
    ? { type: 'cli', name, model: c.model, baseUrl: c.baseUrl, apiKey: c.apiKey } : null;
  const gem = cfg.gemini || {};
  const chain = [
    cli(cfg.qwen, 'Qwen'),
    (readOnly && gem.apiKey) ? { type: 'gemini', name: 'Gemini', model: gem.model } : null,
    cli(cfg.fallback, 'DeepSeek'),
  ].filter(Boolean);

  // Test switch: force the run straight onto one fallback provider (skipping the primary Claude run)
  // so you can confirm e.g. Qwen actually drives a write job, without waiting to hit a real usage
  // limit. Narrow the chain to just that provider; an unconfigured/ineligible name errors clearly.
  let startStep = -1;
  if (forceProvider) {
    const want = String(forceProvider).toLowerCase();
    const only = chain.find((p) => p.name.toLowerCase() === want);
    if (!only) {
      release();
      onEvent('error', { message: `Can't test "${forceProvider}": it isn't configured${readOnly ? '' : ", or it can't run write jobs (Gemini is read-only)"}.` });
      return () => {};
    }
    chain.length = 0; chain.push(only);                 // same array object → closures still see it
    startStep = 0;
  }

  let current = null;     // the live child, so the kill fn can target it
  let killed = false;     // user cancelled → never auto-retry

  // step = -1 → primary claude; 0..n → chain[step]. `run` settles via onEvent (done/error) or
  // hands off to the next link. `why` describes what triggered the hand-off (shown to the user).
  const run = (step) => {
    if (killed) return;
    const provider = step < 0 ? null : chain[step];
    // Advance to the next link in the chain, announcing it. Returns false if the chain is exhausted.
    const advance = (why) => {
      if (killed || step + 1 >= chain.length) return false;
      onEvent('status', { state: 'fallback-retry', message: `${why} — trying ${chain[step + 1].name}.` });
      run(step + 1);
      return true;
    };

    // Gemini: a direct REST call (no child process); it streams + settles (done/error) on its own.
    if (provider && provider.type === 'gemini') {
      onEvent('status', { state: 'fallback', kind, provider: provider.name, model: provider.model || 'gemini' });
      streamGemini(prompt, onEvent, release);
      return;
    }

    const onFallback = step >= 0;
    const model = onFallback ? provider.model : (cfg.models && cfg.models[kind]);
    // Bound MCP startup + tool-call time on every run so a stuck MCP server can't hang us.
    const baseEnv = { ...process.env, MCP_TIMEOUT: MCP_TIMEOUT_MS, MCP_TOOL_TIMEOUT: MCP_TOOL_TIMEOUT_MS };
    const env = onFallback
      ? { ...baseEnv, ANTHROPIC_BASE_URL: provider.baseUrl, ANTHROPIC_AUTH_TOKEN: provider.apiKey, ANTHROPIC_API_KEY: provider.apiKey }
      : baseEnv;
    onEvent('status', { state: onFallback ? 'fallback' : 'starting', cwd, kind, model: model || 'default', provider: onFallback ? provider.name : 'Claude' });

    // `error` (e.g. ENOENT when claude is missing) and `close` can both fire — settle exactly once.
    let settled = false;
    let child, output = '';
    try {
      // stdin: 'ignore' so claude doesn't wait ~3s for piped stdin that never comes
      // (the prompt is passed via args, not stdin). stdout/stderr stay piped for pump().
      child = spawn(cfg.claudePath, buildArgs({ kind, prompt, model, maxTurns: cfg.maxTurns }), {
        cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      settled = true;
      if (advance(`Couldn't launch claude (${err.message})`)) return;
      release();
      onEvent('error', { message: `Failed to launch claude: ${err.message}` });
      return;
    }
    current = child;

    // For stream-json kinds, each stdout line is one JSON event → translate to readable progress.
    // Everything else (chats' plain text, and all stderr) passes through verbatim.
    const streamJson = STREAM_JSON.has(kind);
    const emitLine = (channel, line) => {
      if (channel !== 'out' || !streamJson) { onEvent('log', { channel, line }); return; }
      const s = line.trim();
      if (!s) return;
      let ev; try { ev = JSON.parse(s); } catch { onEvent('log', { channel: 'out', line }); return; }
      for (const o of describeStreamEvent(ev)) onEvent('log', o);
    };
    const pump = (stream, channel) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        output += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) emitLine(channel, line);
      });
      stream.on('end', () => { if (buf.trim()) emitLine(channel, buf); });
    };
    pump(child.stdout, 'out');
    pump(child.stderr, 'err');

    // claude binary missing / can't spawn → ENOENT here (not the try/catch above).
    child.on('error', (err) => {
      if (settled) return; settled = true;
      if (advance(`claude unavailable (${err.message})`)) return;
      release();
      onEvent('error', { message: err.message });
    });
    child.on('close', (code) => {
      if (settled) return; settled = true;
      const limited = code !== 0 && !killed && LIMIT_RE.test(output);
      if (limited && advance(onFallback ? `${provider.name} hit a limit` : 'Claude hit a usage limit')) return;
      release();
      onEvent('done', { code, usedFallback: onFallback ? provider.name : false });
    });
  };

  run(startStep);
  return () => { killed = true; try { current && current.kill('SIGTERM'); } catch { /* noop */ } };
}

// `forceProvider` (optional) runs the inbox straight through one fallback by name ('Qwen'/'DeepSeek')
// to test it — see the Settings "Test a fallback" control.
export const runProcessInbox = (onEvent, forceProvider) =>
  spawnClaude({ kind: 'process', prompt: PROMPTS.process(), forceProvider }, onEvent);

export const runResearch = (idea, onEvent) =>
  spawnClaude({ kind: 'research', prompt: PROMPTS.research(loadConfig(), idea) }, onEvent);

export const runWeeklyReview = (onEvent) =>
  spawnClaude({ kind: 'review', prompt: PROMPTS.review(loadConfig()) }, onEvent);

export const runRefreshHome = (onEvent) =>
  spawnClaude({ kind: 'home', prompt: PROMPTS.home(loadConfig()) }, onEvent);

export const runChat = (messages, onEvent) =>
  spawnClaude({ kind: 'chat', prompt: PROMPTS.chat(loadConfig(), messages) }, onEvent);

export const runNoteChat = (notePath, noteContent, messages, onEvent) =>
  spawnClaude({ kind: 'notechat', prompt: PROMPTS.notechat(loadConfig(), notePath, noteContent, messages) }, onEvent);

// Semantic search: streams nothing to the client — the route collects the model's plain-text path
// list and hands it back on `done` as `raw` (so the route can validate the paths against the vault).
export function runAiSearch(query, onEvent) {
  let out = '';
  return spawnClaude({ kind: 'search', prompt: PROMPTS.search(loadConfig(), query) }, (type, data) => {
    if (type === 'log' && data.channel === 'out') out += data.line + '\n';
    else if (type === 'done') onEvent('done', { ...data, raw: out });
    else onEvent(type, data);                              // status (incl. fallback) + error
  });
}

/** Split the augment run's raw output into a placement anchor + the markdown body to insert. */
export function parseAugment(raw) {
  const t = String(raw || '').replace(/\r/g, '').trim();
  const i = t.indexOf(AUGMENT_SEP);
  let anchor, body;
  if (i >= 0) { anchor = t.slice(0, i); body = t.slice(i + AUGMENT_SEP.length); }
  else { anchor = 'END'; body = t; }                 // no separator → just append the whole thing
  // Anchor = last non-empty line before the separator (ignore any stray preamble), de-quoted.
  const al = anchor.split('\n').map((s) => s.trim()).filter(Boolean);
  anchor = (al.length ? al[al.length - 1] : 'END').replace(/^[`"']+|[`"']+$/g, '').trim() || 'END';
  // Body: drop an accidental wrapping code fence, trim.
  body = body.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return { anchor, body };
}

// Generate the overview text for a note (does NOT touch the file). Streams status/error through and,
// on success, hands the route a parsed { anchor, body } on the `done` event so it can do the insert.
// Read-only, so it inherits the chats' Gemini→DeepSeek fallback chain.
export function runNoteAugment(notePath, noteContent, topic, context, onEvent) {
  let out = '';
  return spawnClaude(
    { kind: 'noteaugment', prompt: PROMPTS.noteaugment(loadConfig(), notePath, noteContent, topic, context) },
    (type, data) => {
      if (type === 'log') { if (data.channel === 'out') out += data.line + '\n'; return; }
      if (type === 'done') {
        if (data.code !== 0) { onEvent('done', { code: data.code, usedFallback: data.usedFallback }); return; }
        onEvent('done', { code: 0, usedFallback: data.usedFallback, ...parseAugment(out) });
        return;
      }
      onEvent(type, data);                              // status (incl. fallback-retry) + error
    },
  );
}

export const runCalSync = (onEvent) =>
  spawnClaude({ kind: 'calsync', prompt: PROMPTS.calsync(loadConfig()) }, onEvent);

export const runAutosort = (onEvent) =>
  spawnClaude({ kind: 'autosort', prompt: PROMPTS.autosort(loadConfig()) }, onEvent);
