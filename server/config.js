import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, '..');
const CONFIG_PATH = join(PROJECT_ROOT, 'config.json');

const DEFAULTS = {
  vaultPath: './vault',
  claudePath: 'claude',
  port: 7777,
  host: '0.0.0.0',
  timezone: 'Asia/Jakarta',
  languages: 'English + Indonesian',
  todoPath: 'TODO/{year}/{month}.md',
  todoFormat: '- [ ] DD Mon DESC',
  ownerName: 'Tim',
};

export function loadConfig() {
  let cfg = { ...DEFAULTS };
  try {
    cfg = { ...cfg, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    /* first run: defaults */
  }
  return cfg;
}

export function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

/** Absolute path to the configured vault (relative paths resolve from project root). */
export function vaultDir(cfg = loadConfig()) {
  return isAbsolute(cfg.vaultPath) ? cfg.vaultPath : resolve(PROJECT_ROOT, cfg.vaultPath);
}
