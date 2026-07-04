// server/runner.js — compile/run a code snippet on the box and return its output.
//
// Powers the phone-first "Code" tab: write a whole program, tap Run, see stdout/stderr. Uses
// cross-spawn (like process.js) so `python`/`gcc`/… launch on Windows dev too, never a shell (args
// are arrays — user code is only ever a file, never interpolated into a command string).
//
// ponytail: no sandbox / no user isolation — this runs arbitrary code on the box. That's the SAME
// posture as the Jupyter/ttyd services already here, on a single-user Tailscale-only box. The guards
// are a wall-clock timeout (kills the whole process group), an output cap, and temp-dir cleanup. If
// this ever leaves Tailscale, wrap each run in nsjail/firejail or a container with cpu+mem ulimits.
import spawn from 'cross-spawn';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { loadConfig } from './config.js';

const WIN = process.platform === 'win32';

// Registry. `{file}` = the source path, `{out}` = the compiled binary path (compiled langs only).
// build present → compile first (its stderr is the "compile" phase); then run. Interpreted langs
// have only `run`. The first token of build (or run) is also what we probe for availability.
const LANGS = {
  python:     { name: 'Python',     ext: 'py',  run: ['python3', '{file}'] },
  javascript: { name: 'JavaScript', ext: 'js',  run: ['node', '{file}'] },
  go:         { name: 'Go',         ext: 'go',  run: ['go', 'run', '{file}'] },
  bash:       { name: 'Bash',       ext: 'sh',  run: ['bash', '{file}'] },
  c:          { name: 'C',          ext: 'c',   build: ['gcc', '{file}', '-o', '{out}'], run: ['{out}'] },
  cpp:        { name: 'C++',        ext: 'cpp', build: ['g++', '{file}', '-o', '{out}'], run: ['{out}'] },
  rust:       { name: 'Rust',       ext: 'rs',  build: ['rustc', '-O', '{file}', '-o', '{out}'], run: ['{out}'] },
  java:       { name: 'Java',       ext: 'java', run: ['java', '{file}'] }, // JDK 11+ single-file (JEP 330)
};

// Order shown in the UI picker.
export const LANG_ORDER = ['python', 'javascript', 'c', 'cpp', 'java', 'go', 'rust', 'bash'];

// Windows dev doesn't ship `python3`; map to `python`. (Linux box has python3.)
const resolveCmd = (cmd) => (WIN && cmd === 'python3' ? 'python' : cmd);

function runCfg() {
  const r = (loadConfig().run) || {};
  return { timeoutMs: r.timeoutMs || 10000, maxOutputBytes: r.maxOutputBytes || 262144 };
}

// Java source-file mode relaxes filename==classname, but naming the file after the public class is
// the safe choice across JDKs. Fall back to Main.java.
function javaFileName(code) {
  const m = /public\s+class\s+(\w+)/.exec(code || '');
  return `${m ? m[1] : 'Main'}.java`;
}

/** Which languages' toolchains are actually installed here (probed once per call, cheap). */
export function availableLangs() {
  const locate = WIN ? 'where' : 'which';
  return LANG_ORDER.map((id) => {
    const spec = LANGS[id];
    const probe = resolveCmd((spec.build || spec.run)[0]);
    let found = false;
    try { found = spawn.sync(locate, [probe], { windowsHide: true }).status === 0; } catch { /* noop */ }
    return { id, name: spec.name, found };
  });
}

// Run one argv step with a timeout + process-group kill. Resolves once with captured output.
function execStep(argv, { cwd, stdin, timeoutMs, cap }) {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    let child;
    try {
      child = spawn(cmd, args, {
        cwd, windowsHide: true,
        detached: !WIN, // own process group so we can kill the whole tree on timeout (POSIX)
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return resolve({ stdout: '', stderr: '', exitCode: 127, timedOut: false, spawnErr: e });
    }
    let out = '', err = '', timedOut = false, settled = false;
    const clip = (buf, chunk) => (buf.length >= cap ? buf : (buf + chunk).slice(0, cap));
    const done = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      timedOut = true;
      try { WIN ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
      catch { try { child.kill('SIGKILL'); } catch { /* noop */ } }
    }, timeoutMs);
    child.stdout.on('data', (d) => { out = clip(out, d.toString()); });
    child.stderr.on('data', (d) => { err = clip(err, d.toString()); });
    child.on('error', (e) => done({ stdout: out, stderr: err, exitCode: 127, timedOut, spawnErr: e }));
    child.on('close', (code) => done({ stdout: out, stderr: err, exitCode: code, timedOut, spawnErr: null }));
    if (typeof stdin === 'string' && stdin) { try { child.stdin.write(stdin); } catch { /* noop */ } }
    try { child.stdin.end(); } catch { /* noop */ }
  });
}

const missing = (cmd) => `${cmd}: command not found — that toolchain isn't installed on the server.`;

/**
 * Compile (if needed) and run `code` for `lang`. Returns:
 *   { stdout, stderr, exitCode, timedOut, durationMs, phase: 'compile'|'run' }
 */
export async function runCode({ lang, code, stdin }) {
  const spec = LANGS[lang];
  if (!spec) throw new Error(`Unknown language: ${lang}`);
  const { timeoutMs, maxOutputBytes: cap } = runCfg();
  const dir = mkdtempSync(join(tmpdir(), 'lifeos-run-'));
  const t0 = Date.now();
  // Hide the internal temp path from compiler messages (e.g. gcc prints the source's absolute path).
  const scrub = (s) => (typeof s === 'string' ? s.split(dir + sep).join('').split(dir).join('') : s);
  const finish = (x) => {
    const o = { stdout: '', stderr: '', exitCode: null, timedOut: false, phase: 'run', ...x, durationMs: Date.now() - t0 };
    o.stdout = scrub(o.stdout); o.stderr = scrub(o.stderr); delete o.spawnErr;
    return o;
  };
  try {
    const fileName = spec.ext === 'java' ? javaFileName(code) : `main.${spec.ext}`;
    const filePath = join(dir, fileName);
    writeFileSync(filePath, code ?? '');
    const outPath = join(dir, WIN ? 'out.exe' : 'out');
    const build = (a) => { const v = a.replace('{file}', filePath).replace('{out}', outPath); return v; };
    const argvOf = (tpl) => { const v = tpl.map(build); v[0] = resolveCmd(v[0]); return v; };

    if (spec.build) {
      const r = await execStep(argvOf(spec.build), { cwd: dir, timeoutMs, cap });
      if (r.spawnErr) return finish({ stderr: missing(resolveCmd(spec.build[0])), exitCode: 127, phase: 'compile' });
      if (r.timedOut || r.exitCode !== 0) return finish({ ...r, phase: 'compile' });
    }
    const r = await execStep(argvOf(spec.run), { cwd: dir, stdin, timeoutMs, cap });
    if (r.spawnErr) return finish({ stderr: missing(resolveCmd(spec.run[0])), exitCode: 127, phase: 'run' });
    return finish({ ...r, phase: 'run' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
