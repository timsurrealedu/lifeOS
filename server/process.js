// cross-spawn (not node:child_process) so the `claude` CLI launches on Windows too,
// where it's a `claude.cmd` shim that bare spawn() can't resolve / refuses to run.
import spawn from 'cross-spawn';
import { loadConfig, vaultDir } from './config.js';

// Only one *writing* claude run at a time — process / research / review / home / calsync mutate the
// vault. Read-only runs (chat) are exempt and may run concurrently. (Find no longer spawns claude.)
let writeRunning = false;
export const isRunning = () => writeRunning;

const READ_ONLY = new Set(['chat', 'notechat']);

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
  // Augment ONE note: append an overview section the user asked for. Edits only that file.
  noteaugment: ['Read', 'Edit', 'Glob', 'Grep'],
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
    + 'Regenerate `Home.md` as a dashboard MOC: links to the top hubs ([[University]], [[Personal]], '
    + '[[TODO]], [[Ideas]]); the most recently edited notes; open/overdue tasks from TODO/; and any '
    + 'notes tagged #needs-filing. Keep it concise and link-rich. Overwrite Home.md only. Finish '
    + 'with a one-line summary.',

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

  // Write an overview of a topic the user felt weak on INTO their open note. The only run that
  // edits a user note from the tutor flow — deliberately additive, never destructive.
  noteaugment: (cfg, notePath, topic, context) =>
    `You are editing **one note** in ${cfg.ownerName}'s Obsidian vault, launched from lifeOS with no `
    + `interactive user. The note is \`${notePath}\`.\n\n`
    + `${cfg.ownerName} was studying this note and asked their tutor about a topic they felt weak on. `
    + `They want a clear overview of that topic added **into this note** for later revision.\n\n`
    + `The topic / question:\n"""\n${topic}\n"""\n`
    + (context ? `\nContext from the tutor conversation (use it, but write your own clean overview):\n"""\n${context}\n"""\n` : '')
    + '\nDo this:\n'
    + `1. Read \`${notePath}\`.\n`
    + '2. **Append** a new section near the end (before any footer/links/source-embed block if present) '
    + 'with an H2 heading like `## Overview — <topic>` (a `#weak-topic` tag on the heading line is fine). '
    + 'Write a concise, self-contained overview: the core idea, key formulas as **LaTeX** (`$…$` / `$$…$$`), '
    + 'and a short worked example or intuition where it helps.\n'
    + '3. **Never delete or rewrite the user\'s existing content** — only add. Match the note\'s existing '
    + 'language and style. Keep `[[wikilinks]]` title-only (no folder paths).\n'
    + '4. Use the `Edit` tool on that one file only; touch nothing else. Finish with a one-line summary.',

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
const LIMIT_RE = /usage limit|rate.?limit|limit reached|session limit|quota|exhausted|overloaded|too many requests|\b429\b|insufficient|out of credit/i;

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
  if (model) args.push('--model', model);
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  args.push('--allowedTools', ...(ALLOWED[kind] || ALLOWED.process));
  return args;
}

/**
 * Spawn `claude -p` in the vault and stream stdout/stderr lines to `onEvent`.
 * onEvent(type, data): type ∈ {status, log, done, error}.
 * Picks the per-task model + turn cap from config, and — if the primary run dies with a
 * usage/rate-limit error and a `fallback` provider is configured — transparently retries the
 * same prompt once against that provider's Anthropic-compatible endpoint.
 * Returns a kill function.
 */
function spawnClaude({ kind, prompt }, onEvent) {
  const readOnly = READ_ONLY.has(kind);
  if (!readOnly && writeRunning) {
    onEvent('error', { message: 'A run is already in progress.' });
    return () => {};
  }
  if (!readOnly) writeRunning = true;
  const release = () => { if (!readOnly) writeRunning = false; };

  const cfg = loadConfig();
  const cwd = vaultDir(cfg);
  const fb = cfg.fallback || {};
  const fallbackReady = !!(fb.apiKey && fb.baseUrl);
  const gem = cfg.gemini || {};
  const geminiReady = !!gem.apiKey; // chats can fall back to Gemini's REST API directly

  let current = null;     // the live child, so the kill fn can target it
  let killed = false;     // user cancelled → never auto-retry

  const attempt = (onFallback) => {
    const model = onFallback ? fb.model : (cfg.models && cfg.models[kind]);
    const env = onFallback
      ? { ...process.env, ANTHROPIC_BASE_URL: fb.baseUrl, ANTHROPIC_AUTH_TOKEN: fb.apiKey, ANTHROPIC_API_KEY: fb.apiKey }
      : process.env;
    onEvent('status', { state: onFallback ? 'fallback' : 'starting', cwd, kind, model: model || 'default' });

    // `error` (e.g. ENOENT when claude is missing) and `close` can both fire — settle exactly once.
    let settled = false;
    // Read-only chats (per-note tutor + vault chat) can answer via Gemini's REST API directly: their
    // prompt is self-contained, so no tools/file edits are needed. Returns true if it took over.
    const geminiFallback = (msg) => {
      if (!(READ_ONLY.has(kind) && geminiReady && !onFallback)) return false;
      onEvent('status', { state: 'fallback-retry', message: msg + ` — answering via Gemini (${gem.model || 'gemini'}).` });
      streamGemini(prompt, onEvent, release);
      return true;
    };

    let child, output = '';
    try {
      // stdin: 'ignore' so claude doesn't wait ~3s for piped stdin that never comes
      // (the prompt is passed via args, not stdin). stdout/stderr stay piped for pump().
      child = spawn(cfg.claudePath, buildArgs({ kind, prompt, model, maxTurns: cfg.maxTurns }), {
        cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      settled = true;
      if (geminiFallback('claude unavailable')) return;
      release();
      onEvent('error', { message: `Failed to launch claude: ${err.message}` });
      return;
    }
    current = child;

    const pump = (stream, channel) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        output += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) onEvent('log', { channel, line });
      });
      stream.on('end', () => { if (buf.trim()) onEvent('log', { channel, line: buf }); });
    };
    pump(child.stdout, 'out');
    pump(child.stderr, 'err');

    // claude binary missing / can't spawn → ENOENT here (not the try/catch above).
    child.on('error', (err) => {
      if (settled) return; settled = true;
      if (geminiFallback('claude unavailable')) return;
      release();
      onEvent('error', { message: err.message });
    });
    child.on('close', (code) => {
      if (settled) return; settled = true;
      const limited = code !== 0 && !onFallback && !killed && LIMIT_RE.test(output);
      // Preferred chat fallback: Gemini when the primary hit a usage/session limit.
      if (limited && geminiFallback('Primary hit a limit')) return;
      // Otherwise retry once on the Anthropic-compatible fallback provider (DeepSeek/GLM).
      if (limited && fallbackReady) {
        onEvent('status', { state: 'fallback-retry', message: `Primary hit a limit — retrying on fallback (${fb.model || 'fallback'}).` });
        return attempt(true);
      }
      release();
      onEvent('done', { code, usedFallback: onFallback });
    });
  };

  attempt(false);
  return () => { killed = true; try { current && current.kill('SIGTERM'); } catch { /* noop */ } };
}

export const runProcessInbox = (onEvent) =>
  spawnClaude({ kind: 'process', prompt: PROMPTS.process() }, onEvent);

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

export const runNoteAugment = (notePath, topic, context, onEvent) =>
  spawnClaude({ kind: 'noteaugment', prompt: PROMPTS.noteaugment(loadConfig(), notePath, topic, context) }, onEvent);

export const runCalSync = (onEvent) =>
  spawnClaude({ kind: 'calsync', prompt: PROMPTS.calsync(loadConfig()) }, onEvent);

export const runAutosort = (onEvent) =>
  spawnClaude({ kind: 'autosort', prompt: PROMPTS.autosort(loadConfig()) }, onEvent);
