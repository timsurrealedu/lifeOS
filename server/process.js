import { spawn } from 'node:child_process';
import { loadConfig, vaultDir } from './config.js';

// Only one *writing* claude run at a time (process / research / review / home all
// mutate the vault). Read-only runs (find) are exempt and can run concurrently.
let writeRunning = false;
export const isRunning = () => writeRunning;

const ALLOWED = {
  process: [
    'Edit', 'Write', 'Read', 'Bash', 'Glob', 'Grep',
    'mcp__claude_ai_Google_Calendar__create_event',
  ],
  research: ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  find: ['Read', 'Glob', 'Grep'], // read-only — no Write/Edit/Bash on purpose
  review: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  home: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
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

  find: (cfg, q) =>
    `You are the read-only "Find" tool for ${cfg.ownerName}'s Obsidian vault, launched from lifeOS `
    + 'with no interactive user attached. Answer the question below by searching the vault\'s '
    + 'markdown notes (Grep/Glob/Read only). Do NOT modify any files. Cite the notes you used as '
    + '[[wikilinks]]. If the answer is not in the vault, say so plainly.\n\n'
    + `Question: ${q}`,

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
};

/**
 * Spawn `claude -p` in the vault and stream stdout/stderr lines to `onEvent`.
 * onEvent(type, data): type ∈ {status, log, done, error}.
 * Returns a kill function.
 */
function spawnClaude({ kind, prompt }, onEvent) {
  const readOnly = kind === 'find';
  if (!readOnly && writeRunning) {
    onEvent('error', { message: 'A run is already in progress.' });
    return () => {};
  }
  if (!readOnly) writeRunning = true;
  const release = () => { if (!readOnly) writeRunning = false; };

  const cfg = loadConfig();
  const cwd = vaultDir(cfg);
  onEvent('status', { state: 'starting', cwd, kind });

  const args = [
    '-p', prompt,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...(ALLOWED[kind] || ALLOWED.find),
  ];

  let child;
  try {
    child = spawn(cfg.claudePath, args, { cwd, env: process.env });
  } catch (err) {
    release();
    onEvent('error', { message: `Failed to launch claude: ${err.message}` });
    return () => {};
  }

  const pump = (stream, channel) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) onEvent('log', { channel, line });
    });
    stream.on('end', () => { if (buf.trim()) onEvent('log', { channel, line: buf }); });
  };
  pump(child.stdout, 'out');
  pump(child.stderr, 'err');

  child.on('error', (err) => { release(); onEvent('error', { message: err.message }); });
  child.on('close', (code) => { release(); onEvent('done', { code }); });

  return () => { try { child.kill('SIGTERM'); } catch { /* noop */ } };
}

export const runProcessInbox = (onEvent) =>
  spawnClaude({ kind: 'process', prompt: PROMPTS.process() }, onEvent);

export const runResearch = (idea, onEvent) =>
  spawnClaude({ kind: 'research', prompt: PROMPTS.research(loadConfig(), idea) }, onEvent);

export const runFind = (q, onEvent) =>
  spawnClaude({ kind: 'find', prompt: PROMPTS.find(loadConfig(), q) }, onEvent);

export const runWeeklyReview = (onEvent) =>
  spawnClaude({ kind: 'review', prompt: PROMPTS.review(loadConfig()) }, onEvent);

export const runRefreshHome = (onEvent) =>
  spawnClaude({ kind: 'home', prompt: PROMPTS.home(loadConfig()) }, onEvent);
