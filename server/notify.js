// Plan tab reminders — local push notifications for every timed task. Independent of Google
// Calendar: it notifies for the vault's own TODO
// checklist, not the read-only synced calendar. Runs a once-a-minute scan on the server (already
// live 24/7), so it fires even when no device has the app open — the same feel as Google Calendar's
// reminders, without needing a real Google Calendar write scope.
import webpush from 'web-push';
import { loadConfig, saveConfig } from './config.js';
import { listTasks, readPushSubs, addPushSub, removePushSub, readNotifiedKeys, markNotified } from './vault.js';

const CHECK_MS = 15 * 1000;   // avg delivery delay ≈ half this — 60s felt laggy in practice
// Skip a reminder more than this far past its trigger time — e.g. after the server was down — so
// catching up doesn't dump a backlog of stale notifications on you all at once.
const STALE_MS = 15 * 60 * 1000;

/** Ensure a VAPID keypair exists (generated once, persisted in config.json). */
function ensureVapidKeys() {
  let cfg = loadConfig();
  if (!cfg.push.publicKey || !cfg.push.privateKey) {
    const keys = webpush.generateVAPIDKeys();
    cfg = saveConfig({ push: { publicKey: keys.publicKey, privateKey: keys.privateKey } });
  }
  webpush.setVapidDetails('mailto:admin@localhost', cfg.push.publicKey, cfg.push.privateKey);
  return cfg.push.publicKey;
}

export const getPublicKey = () => loadConfig().push.publicKey || ensureVapidKeys();
export const subscribe = (sub) => addPushSub(sub);
export const unsubscribe = (endpoint) => removePushSub(endpoint);

/** "Now" as calendar-date/time components in `tz`, expressed as fake-UTC ms so it can be compared
 *  directly against a task's trigger time (built the same way in `checkReminders`) — see that
 *  function's comment for why this sidesteps real-timezone/DST arithmetic entirely. */
function nowInZoneMs(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute);
}

async function sendToAllSubs(payload) {
  const subs = readPushSubs();
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try { await webpush.sendNotification(sub, body); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) removePushSub(sub.endpoint); }
  }
}

export function dueReminders(t, nowMs, notified = new Set()) {
  if (t.done || !t.date || !t.time) return [];
  const [y, mo, d] = t.date.split('-').map(Number);
  const [h, mi] = t.time.split(':').map(Number);
  const eventMs = Date.UTC(y, mo - 1, d, h, mi);
  return t.reminderMinutes.flatMap((minutes) => {
    const key = `${t.file}#${t.line}#${t.date}#${t.time}#${minutes}`;
    const age = nowMs - (eventMs - minutes * 60000);
    return !notified.has(key) && age >= 0 && age <= STALE_MS ? [{ key, minutes }] : [];
  });
}

/** Scan open, timed tasks and push at 30 minutes, 15 minutes, and the event time. */
async function checkReminders() {
  const cfg = loadConfig();
  const nowMs = nowInZoneMs(cfg.timezone);
  const notified = readNotifiedKeys();
  const fired = [];
  for (const t of listTasks()) {
    for (const { key, minutes } of dueReminders(t, nowMs, notified)) {
      fired.push(key);
      const when = minutes ? `${minutes} minutes` : 'Now';
      await sendToAllSubs({ title: t.desc, body: `${when} · ${t.date} at ${t.time}`, tag: key });
    }
  }
  if (fired.length) markNotified(fired);
}

let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  ensureVapidKeys();
  checkReminders().catch(() => {});
  setInterval(() => { checkReminders().catch(() => {}); }, CHECK_MS);
}
