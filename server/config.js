import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  // Per-task model so cheap runs don't burn a premium model. Empty/absent → CLI default.
  // (chat = the read-only advisor; bump to 'sonnet' for deeper advice at higher token cost.)
  models: { process: 'sonnet', research: 'sonnet', review: 'haiku', home: 'haiku', chat: 'haiku', calsync: 'haiku', autosort: 'haiku' },
  // Runaway-loop guard: cap agent turns per run. 0/absent → no cap. Bumped to 80 so heavy items
  // (e.g. "make practice problems for each topic from this image") finish instead of being killed
  // mid-task at the cap — which also leaves processing half-done.
  maxTurns: 80,
  // Fallback chain, tried in order when the primary run hits a usage/rate limit:
  //   claude → qwen → gemini → fallback (DeepSeek/GLM)
  // qwen + fallback expose Anthropic-compatible endpoints, so the same `claude` CLI + skills keep
  // working; gemini is REST-only (read-only chats + add-to-note), so on write jobs it's skipped and
  // the chain is qwen → fallback. Empty apiKey → that link skipped.
  //   Qwen (DashScope) → baseUrl "https://dashscope-intl.aliyuncs.com/api/v2/apps/claude-code-proxy",
  //   model "claude-sonnet-5" — NOT "qwen3-coder-plus". This app-scoped DashScope proxy is pinned to
  //   one backend model and ignores whatever `model` string it's sent (verified: even a nonsense
  //   model name gets 200'd and answered by the same qwen3-coder-plus backend). Meanwhile Claude Code
  //   only builds a spec-correct request (system prompt as the top-level `system` field) for a model
  //   id it recognizes as first-party; for an unrecognized id like "qwen3-coder-plus" it takes a
  //   generic path that stuffs the system prompt into messages[0] as {role:"system"} instead —
  //   DashScope's proxy validates strictly and 500s on that role (real Anthropic + DeepSeek's proxy
  //   both tolerate it fine). Sending a recognized Claude model id sidesteps the bug for free, since
  //   DashScope ignores the field anyway.

  qwen: { baseUrl: '', apiKey: '', model: '' },
  // DeepSeek/GLM Anthropic-compatible endpoint (3rd in the chain, after qwen + gemini). Examples:
  //   DeepSeek → baseUrl "https://api.deepseek.com/anthropic", model "deepseek-v4-pro" (or -flash)
  //   GLM (Z.ai) → baseUrl "https://api.z.ai/api/anthropic",   model "glm-4.6"
  fallback: { baseUrl: '', apiKey: '', model: '' },
  // Gemini (Google AI Studio) fallback for the read-only AI features (per-note tutor + vault chat +
  // add-to-note) only — 2nd in the chain, after Qwen and before DeepSeek. Gemini isn't
  // Anthropic-compatible, so it can't drive the `claude` CLI like `fallback` does; instead the
  // server calls Gemini's REST API directly with the same (self-contained) prompt when the primary
  // run hits a usage/rate limit. Empty apiKey → disabled. Get a free key at
  // https://aistudio.google.com/apikey
  gemini: { apiKey: '', model: 'gemini-2.5-flash' },
  // Code runner (the phone "Code" tab). `dir` = a folder the tab reads/writes files in (e.g. a
  // Syncthing-synced ~/mycode so phone edits sync to your other machines); empty → files disabled.
  run: { timeoutMs: 10000, maxOutputBytes: 262144, dir: '' },
  // Web Push keypair for Plan reminders (local task notifications — not Google Calendar). Generated
  // once on first boot by notify.js and persisted here; never sent to the client except publicKey.
  push: { publicKey: '', privateKey: '' },
};

export function loadConfig() {
  let cfg = { ...DEFAULTS };
  try {
    const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    cfg = { ...cfg, ...saved };
    // Deep-merge the known nested objects so a partial override (e.g. just fallback.apiKey)
    // doesn't drop the other defaults.
    cfg.models = { ...DEFAULTS.models, ...(saved.models || {}) };
    cfg.qwen = { ...DEFAULTS.qwen, ...(saved.qwen || {}) };
    cfg.fallback = { ...DEFAULTS.fallback, ...(saved.fallback || {}) };
    cfg.gemini = { ...DEFAULTS.gemini, ...(saved.gemini || {}) };
    cfg.run = { ...DEFAULTS.run, ...(saved.run || {}) };
    cfg.push = { ...DEFAULTS.push, ...(saved.push || {}) };
  } catch {
    /* first run: defaults */
  }
  return cfg;
}

// Never echo real API keys back to the browser (GET /api/config) — a devtools/network-tab peek
// would otherwise hand out a working key in plaintext. maskConfig() is what the client sees;
// the sentinel below is what the client re-sends for a field it never touched, which the merge
// in saveConfig() recognizes and resolves to "keep the existing key" rather than overwriting it.
export const KEY_MASK = '••••••••';
export function maskConfig(cfg) {
  const mask = (o) => ({ ...o, apiKey: o.apiKey ? KEY_MASK : '' });
  return {
    ...cfg, qwen: mask(cfg.qwen), fallback: mask(cfg.fallback), gemini: mask(cfg.gemini),
    push: { publicKey: cfg.push.publicKey },   // privateKey never leaves the server
  };
}
function mergeProvider(prev, patch) {
  if (!patch) return prev;
  const p = { ...patch };
  if (p.apiKey === KEY_MASK) delete p.apiKey;      // unchanged sentinel → keep the existing key
  return { ...prev, ...p };
}

export function saveConfig(patch) {
  const prev = loadConfig();
  const cfg = { ...prev, ...patch };
  // Merge nested objects rather than letting a partial patch clobber them.
  if (patch.models) cfg.models = { ...prev.models, ...patch.models };
  cfg.qwen = mergeProvider(prev.qwen, patch.qwen);
  cfg.fallback = mergeProvider(prev.fallback, patch.fallback);
  cfg.gemini = mergeProvider(prev.gemini, patch.gemini);
  if (patch.run) cfg.run = { ...prev.run, ...patch.run };
  if (patch.push) cfg.push = { ...prev.push, ...patch.push };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

/** Absolute path to the configured vault (relative paths resolve from project root). */
export function vaultDir(cfg = loadConfig()) {
  return isAbsolute(cfg.vaultPath) ? cfg.vaultPath : resolve(PROJECT_ROOT, cfg.vaultPath);
}

// CLIs the process-inbox run uses to turn an attached document into text. PDFs are read natively by
// the `claude` Read tool, so these only matter for Office files (docx/pptx/xlsx) — but a PDF tool is
// still a useful fallback for scanned/odd PDFs.
const DOC_TOOLS = [
  { cmd: 'pandoc', label: 'pandoc', handles: 'docx · pptx · odt · html → text (best all-rounder)' },
  { cmd: 'soffice', label: 'libreoffice', handles: 'docx · pptx · xlsx → text' },
  { cmd: 'pdftotext', label: 'pdftotext (poppler)', handles: 'pdf → text (fallback; PDFs read natively too)' },
];

let _docToolsCache = null;
/** Detect which document-extraction CLIs are on PATH. Cached (PATH doesn't change mid-process). */
export function checkDocTools() {
  if (_docToolsCache) return _docToolsCache;
  const locate = process.platform === 'win32' ? 'where' : 'which';
  _docToolsCache = DOC_TOOLS.map((t) => {
    let found = false;
    try { found = spawnSync(locate, [t.cmd], { windowsHide: true }).status === 0; } catch { /* noop */ }
    return { ...t, found };
  });
  return _docToolsCache;
}
