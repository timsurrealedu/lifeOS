import { spawn } from 'node:child_process';
import { loadConfig, vaultDir } from './config.js';

let running = false;
export const isRunning = () => running;

const PROMPT =
  'Run the process-inbox skill on this vault. This run was launched from the lifeOS app with '
  + 'no interactive user attached: when unsure where something belongs, file it to Captures/ '
  + 'with #needs-filing rather than asking. Give a concise final summary of what you did.';

const ALLOWED = [
  'Edit', 'Write', 'Read', 'Bash',
  'mcp__claude_ai_Google_Calendar__create_event',
];

/**
 * Spawn `claude -p "process inbox"` in the vault and stream stdout/stderr lines to `onEvent`.
 * onEvent(type, data): type ∈ {status, log, done, error}
 */
export function runProcessInbox(onEvent) {
  if (running) {
    onEvent('error', { message: 'A processing run is already in progress.' });
    return () => {};
  }
  running = true;
  const cfg = loadConfig();
  const cwd = vaultDir(cfg);

  onEvent('status', { state: 'starting', cwd });

  const args = [
    '-p', PROMPT,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...ALLOWED,
  ];

  let child;
  try {
    child = spawn(cfg.claudePath, args, { cwd, env: process.env });
  } catch (err) {
    running = false;
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

  child.on('error', (err) => {
    running = false;
    onEvent('error', { message: err.message });
  });
  child.on('close', (code) => {
    running = false;
    onEvent('done', { code });
  });

  return () => { try { child.kill('SIGTERM'); } catch { /* noop */ } };
}
