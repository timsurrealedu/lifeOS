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

function ssh(cmd, { timeoutMs = 30000 } = {}) {
  const { host, key } = box();
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, cmd]);
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

export async function uploadApproved() {
  const { dir } = box();
  return await ssh(`cd ${dir} && python3 publish.py upload`, { timeoutMs: 900000 });
}

export async function renderNow() {
  const { dir } = box();
  // Detached on the box (a render takes minutes); progress lands in cron.log.
  await ssh(`cd ${dir} && flock -n /tmp/stewie.lock -c 'env PIPER_BIN=/home/ubuntu/piper/piper nohup python3 run.py --once >> cron.log 2>&1' </dev/null >/dev/null 2>&1 & echo started`);
  return 'render started';
}

export async function tailLog(lines = 40) {
  const { dir } = box();
  return await ssh(`tail -n ${Number(lines) || 40} ${dir}/cron.log 2>/dev/null || echo "(no log yet)"`);
}

// Stream an mp4 from the box for in-browser preview (+faststart mp4s play progressively).
export function streamVideo(stamp, res) {
  if (!STAMP.test(stamp)) { res.status(400).end('bad stamp'); return; }
  const { host, key, dir } = box();
  const child = spawn('ssh', ['-i', key, '-o', 'BatchMode=yes', host, `cat ${dir}/out/${stamp}.mp4`]);
  res.set('Content-Type', 'video/mp4');
  child.stdout.pipe(res);
  child.on('close', (code) => { if (code !== 0 && !res.headersSent) res.status(404); if (!res.writableEnded) res.end(); });
  res.on('close', () => child.kill());
}
