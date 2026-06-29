// cross-spawn (not node:child_process) so the `claude` CLI launches on Windows too,
// where it's a `claude.cmd` shim that bare spawn() can't resolve / refuses to run.
import spawn from 'cross-spawn';
import { loadConfig, vaultDir } from './config.js';

// Only one *writing* claude run at a time — process / research / review / home / calsync mutate the
// vault. Read-only runs (chat) are exempt and may run concurrently. (Find no longer spawns claude.)
let writeRunning = false;
export const isRunning = () => writeRunning;

const READ_ONLY = new Set(['chat']);

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
const LIMIT_RE = /usage limit|rate.?limit|quota|exhausted|overloaded|too many requests|\b429\b|insufficient|out of credit/i;

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

  let current = null;     // the live child, so the kill fn can target it
  let killed = false;     // user cancelled → never auto-retry

  const attempt = (onFallback) => {
    const model = onFallback ? fb.model : (cfg.models && cfg.models[kind]);
    const env = onFallback
      ? { ...process.env, ANTHROPIC_BASE_URL: fb.baseUrl, ANTHROPIC_AUTH_TOKEN: fb.apiKey, ANTHROPIC_API_KEY: fb.apiKey }
      : process.env;
    onEvent('status', { state: onFallback ? 'fallback' : 'starting', cwd, kind, model: model || 'default' });

    let child, output = '';
    try {
      // stdin: 'ignore' so claude doesn't wait ~3s for piped stdin that never comes
      // (the prompt is passed via args, not stdin). stdout/stderr stay piped for pump().
      child = spawn(cfg.claudePath, buildArgs({ kind, prompt, model, maxTurns: cfg.maxTurns }), {
        cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
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

    child.on('error', (err) => { release(); onEvent('error', { message: err.message }); });
    child.on('close', (code) => {
      // Retry on the fallback provider once, only for a genuine capacity failure.
      if (code !== 0 && !onFallback && !killed && fallbackReady && LIMIT_RE.test(output)) {
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

export const runCalSync = (onEvent) =>
  spawnClaude({ kind: 'calsync', prompt: PROMPTS.calsync(loadConfig()) }, onEvent);

export const runAutosort = (onEvent) =>
  spawnClaude({ kind: 'autosort', prompt: PROMPTS.autosort(loadConfig()) }, onEvent);
