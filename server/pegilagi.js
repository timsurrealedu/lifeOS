// Pegilagi Studio - marketing video pipeline on the same Oracle A1 box.
// Reads the repo's out/ manifests and starts the existing render-next command over SSH.
import spawn from 'cross-spawn';
import { loadConfig } from './config.js';

const DEFAULTS = {
  host: 'ubuntu@168.110.202.46',
  key: 'C:\\Users\\timsurreal\\Downloads\\ssh-key-2026-07-02.key',
  dir: '/home/ubuntu/pegilagiMarketing',
};
const box = () => ({ ...DEFAULTS, ...(loadConfig().pegilagi || {}) });

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
    const t = setTimeout(() => { child.kill(); reject(new Error('pegilagi box timed out')); }, timeoutMs);
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

const ID = /^\d{4}-\d{2}-\d{2}-\d{3}-[a-z0-9-]+$/;
function safeId(id) {
  const value = String(id || '');
  if (!ID.test(value)) throw new Error('bad content id');
  return value;
}

export async function listItems() {
  const { dir } = box();
  const py = `
import json, os
from pathlib import Path
root = Path(${JSON.stringify(dir)})
manifest = json.load(open(root / "out" / "upload-manifest.json"))
rendered_dir = root / "out" / "rendered"
items = []
for item in manifest.get("items", []):
    cid = item.get("id", "")
    side = rendered_dir / (cid + ".json")
    rendered = {}
    if side.exists():
        rendered = json.load(open(side))
    video = root / "out" / "videos" / (cid + ".mp4")
    storyboard = root / item.get("files", {}).get("storyboard", "")
    status = rendered.get("status") or item.get("status") or "needs_approval"
    items.append({
        "id": cid,
        "stamp": cid,
        "title": item.get("title", cid),
        "scheduledDate": item.get("scheduledDate", ""),
        "status": status,
        "channels": item.get("channels", []),
        "files": item.get("files", {}),
        "hasVideo": video.exists(),
        "hasStoryboard": storyboard.exists(),
        "renderedAt": rendered.get("renderedAt"),
    })
print(json.dumps({
    "mode": manifest.get("mode", "approval-assisted"),
    "channels": manifest.get("channels", []),
    "items": sorted(items, key=lambda x: x["id"], reverse=True),
}))
`.trim();
  return JSON.parse(await ssh(`python3 - <<'PY'\n${py}\nPY`));
}

export async function lifeosExport() {
  const { dir } = box();
  return JSON.parse(await ssh(`cat ${dir}/out/lifeos-export.json`, { timeoutMs: 30000 }));
}

export async function renderNext() {
  const { dir } = box();
  await ssh(`cd ${dir} && flock -n /tmp/pegilagi.lock -c 'nohup env FFMPEG=/usr/bin/ffmpeg npm run studio -- render-next >> render.log 2>&1' </dev/null >/dev/null 2>&1 & echo started`);
  return 'render started';
}

export async function tailLog(lines = 60) {
  const { dir } = box();
  return await ssh(`tail -n ${Number(lines) || 60} ${dir}/render.log 2>/dev/null || tail -n ${Number(lines) || 60} ${dir}/studio.log 2>/dev/null || echo "(no log yet)"`);
}

export function streamVideo(id, res) {
  try { id = safeId(id); } catch { res.status(400).end('bad content id'); return; }
  const { dir } = box();
  const child = spawnBox(`cat ${dir}/out/videos/${id}.mp4`);
  res.set('Content-Type', 'video/mp4');
  child.stdout.pipe(res);
  child.on('close', (code) => { if (code !== 0 && !res.headersSent) res.status(404); if (!res.writableEnded) res.end(); });
  res.on('close', () => child.kill());
}

export async function storyboardHtml(id) {
  id = safeId(id);
  const { dir } = box();
  return await ssh(`cat ${dir}/out/storyboards/${id}.html`);
}
