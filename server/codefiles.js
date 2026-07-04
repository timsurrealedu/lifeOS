// server/codefiles.js — browse/read/write files in the user's synced code folder (config `run.dir`,
// e.g. ~/mycode synced across devices by Syncthing). Powers the Code tab's open/save so a snippet
// written on the phone lands in a real file and syncs everywhere.
//
// All paths are guarded to stay inside run.dir (same startsWith(dir+sep) guard the vault writes use).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, sep, extname, dirname } from 'node:path';
import { loadConfig } from './config.js';

// Text/code files worth listing. Opening is allowed for any of these; running only for EXT_LANG.
const CODE_EXT = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp',
  '.hh', '.java', '.go', '.rs', '.sh', '.bash', '.rb', '.php', '.lua', '.sql', '.html', '.css', '.json',
  '.yaml', '.yml', '.toml', '.md', '.txt']);
const EXT_LANG = {
  '.py': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.java': 'java', '.go': 'go', '.rs': 'rust', '.sh': 'bash', '.bash': 'bash',
};
const SKIP_DIR = new Set(['.git', '.stfolder', '.stversions', 'node_modules', 'target', 'build', 'dist',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'bin', 'obj', '.cache']);
const MAX_FILES = 2000;
const MAX_READ = 1024 * 1024; // 1 MB — don't try to edit huge/binary files here

export function codeDir(cfg = loadConfig()) {
  const d = (cfg.run && cfg.run.dir) || '';
  if (!d) return null;
  return resolve(d); // normalize separators so the startsWith path-guard matches on Windows too
}
export const extToLang = (name) => EXT_LANG[extname(name).toLowerCase()] || null;

function guard(dir, rel) {
  const clean = String(rel || '').replace(/^[/\\]+/, '');
  const abs = resolve(dir, clean);
  if (abs !== dir && !abs.startsWith(dir + sep)) throw new Error('path is outside the code folder');
  return { abs, clean };
}

export function listCodeFiles(cfg = loadConfig()) {
  const dir = codeDir(cfg);
  if (!dir || !existsSync(dir)) return { dir, files: [] };
  const out = [];
  const walk = (abs, rel, depth) => {
    if (out.length >= MAX_FILES || depth > 8) return;
    let ents; try { ents = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= MAX_FILES) break;
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !SKIP_DIR.has(e.name)) walk(join(abs, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1); continue; }
      const ext = extname(e.name).toLowerCase();
      if (!CODE_EXT.has(ext)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      out.push({ path: r, name: e.name, lang: EXT_LANG[ext] || null });
    }
  };
  walk(dir, '', 0);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return { dir, files: out };
}

export function readCodeFile(cfg, rel) {
  const dir = codeDir(cfg); if (!dir) throw new Error('code folder not configured (set run.dir)');
  const { abs, clean } = guard(dir, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error('not found');
  if (statSync(abs).size > MAX_READ) throw new Error('file too large to edit here');
  return { path: clean, content: readFileSync(abs, 'utf8'), lang: extToLang(clean) };
}

export function saveCodeFile(cfg, rel, content) {
  const dir = codeDir(cfg); if (!dir) throw new Error('code folder not configured (set run.dir)');
  const { abs, clean } = guard(dir, rel);
  if (!clean) throw new Error('name the file first');
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content ?? '');
  return { path: clean };
}
