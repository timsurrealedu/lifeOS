// Stewie Studio — manage the video pipeline running on the Oracle A1 box over SSH.
// The box is the source of truth (sidecar JSONs in ~/stewie/out); lifeOS is a remote control.
// Override host/key/dir via a `stewie` object in config.json; defaults match the current box.
import spawn from 'cross-spawn';
import { loadConfig } from './config.js';

const DEFAULTS = {
  host: 'ubuntu@168.110.202.46',
  key: 'C:\\Users\\timsurreal\\Downloads\\ssh-key-2026-07-02.key',
  dir: '/home/ubuntu/stewie',
};
const box = () => ({ ...DEFAULTS, ...(loadConfig().stewie || {}) });

// host: "local" runs on this machine (the box hosts the pipeline itself); anything
// else is `ssh -i key host` (dev machine driving the box remotely).
function spawnBox(cmd) {
  const { host, key } = box();
  return host === 'local'
    ? spawn('sh', ['-c', cmd])
    : spawn('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, cmd]);
}

function ssh(cmd, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnBox(cmd);
    let out = '', err = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('box timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `ssh exit ${code}`).trim().slice(0, 400)));
    });
  });
}

const STAMP = /^[0-9]{8}-[0-9]{6}$/;

export async function listVideos() {
  const { dir } = box();
  const py = 'import json,glob,os; os.chdir("' + dir + '/out"); ' +
    'print(json.dumps([dict(json.load(open(f)), stamp=f[:-5]) for f in sorted(glob.glob("*.json"), reverse=True)]))';
  return JSON.parse(await ssh(`python3 -c '${py}'`));
}

export async function videoStats() {
  const { dir } = box();
  try { return JSON.parse(await ssh(`cd ${dir} && python3 publish.py stats`, { timeoutMs: 60000 })); }
  catch { return {}; }   // box offline / no creds yet — the queue still renders
}

export async function approve(stamps, all = false) {
  const { dir } = box();
  const args = all ? '--all' : stamps.filter((s) => STAMP.test(s)).join(' ');
  if (!args) throw new Error('nothing to approve');
  return await ssh(`cd ${dir} && python3 publish.py approve ${args}`);
}

export async function channelAnalytics() {
  const { dir } = box();
  try { return JSON.parse(await ssh(`cd ${dir} && python3 publish.py channel`, { timeoutMs: 60000 })); }
  catch (e) { return { now: {}, history: [], error: e.message }; }   // box/creds down — Stats degrades softly
}

export async function reject(stamps) {
  const { dir } = box();
  const args = stamps.filter((s) => STAMP.test(s)).join(' ');
  if (!args) throw new Error('nothing to reject');
  return await ssh(`cd ${dir} && python3 publish.py reject ${args}`);
}

export async function deleteLocal(stamps) {
  const { dir } = box();
  const args = stamps.filter((s) => STAMP.test(s)).join(' ');
  if (!args) throw new Error('nothing to delete');
  return await ssh(`cd ${dir} && python3 publish.py delete ${args}`);
}

export async function uploadApproved() {
  const { dir } = box();
  return await ssh(`cd ${dir} && python3 publish.py upload`, { timeoutMs: 900000 });
}

export async function renderNow() {
  const { dir } = box();
  await syncAiProvider(loadConfig().defaultProvider || 'claude');
  // Detached on the box (a render takes minutes); progress lands in cron.log.
  await ssh(`cd ${dir} && flock -n /tmp/stewie.lock -c 'env PIPER_BIN=/home/ubuntu/piper/piper nohup python3 run.py --once >> cron.log 2>&1' </dev/null >/dev/null 2>&1 & echo started`);
  return 'render started';
}

export async function tailLog(lines = 40) {
  const { dir } = box();
  return await ssh(`tail -n ${Number(lines) || 40} ${dir}/cron.log 2>/dev/null || echo "(no log yet)"`);
}

// Map lifeOS provider names to the env keys Stewie's multi-provider llm.py expects.
const STEWIE_KEY_MAP = {
  claude: 'ANTHROPIC_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

// Copy the selected provider's API key from lifeOS config to Stewie when it isn't already on the box.
function lifeosKeyFor(provider, cfg) {
  if (provider === 'kimi') return cfg.kimi?.apiKey;
  if (provider === 'gemini') return cfg.gemini?.apiKey;
  if (provider === 'deepseek') return cfg.fallback?.apiKey;
  return undefined; // lifeOS has no stored Claude API key (Claude CLI manages its own).
}

// Enable only the chosen provider's API key in ~/stewie/secrets/env and disable the others.
// Other keys are commented out (not deleted) so switching back preserves them.
export async function syncAiProvider(provider) {
  const wantKey = STEWIE_KEY_MAP[provider];
  if (!wantKey) return; // unknown provider → nothing to sync

  const cfg = loadConfig();
  const { dir } = box();
  const envPath = `${dir}/secrets/env`;

  // Read current env file from the box (best effort — box may be offline).
  let current = '';
  try { current = await ssh(`cat ${envPath} 2>/dev/null || true`); } catch { /* box offline */ }

  const knownKeys = new Set(Object.values(STEWIE_KEY_MAP));
  const lines = current.split('\n');
  const out = [];
  let hasWant = false;

  for (const raw of lines) {
    const m = raw.match(/^(\s*)#?\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (!m) { out.push(raw); continue; }
    const [, indent, key, val] = m;
    if (!knownKeys.has(key)) { out.push(raw); continue; }
    if (key === wantKey) {
      out.push(`${indent}${key}=${val}`);
      hasWant = true;
    } else {
      out.push(`${indent}# ${key}=${val}`);
    }
  }

  // If the wanted key isn't on the box yet, seed it from lifeOS's own provider config.
  if (!hasWant) {
    const keyVal = lifeosKeyFor(provider, cfg);
    if (keyVal) out.push(`${wantKey}=${keyVal}`);
  }

  const content = out.join('\n');
  const b64 = Buffer.from(content).toString('base64');
  await ssh(`mkdir -p ${dir}/secrets && echo '${b64}' | base64 -d > ${envPath}`);
}

// Stream an mp4 from the box for in-browser preview (+faststart mp4s play progressively).
export function streamVideo(stamp, res) {
  if (!STAMP.test(stamp)) { res.status(400).end('bad stamp'); return; }
  const { dir } = box();
  const child = spawnBox(`cat ${dir}/out/${stamp}.mp4`);
  res.set('Content-Type', 'video/mp4');
  child.stdout.pipe(res);
  child.on('close', (code) => { if (code !== 0 && !res.headersSent) res.status(404); if (!res.writableEnded) res.end(); });
  res.on('close', () => child.kill());
}
