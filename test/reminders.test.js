import test from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders } from '../server/notify.js';

const task = {
  done: false, date: '2026-07-19', time: '10:00', reminderMinutes: [30, 15, 0],
  file: 'TODO/2026/July.md', line: 4,
};

test('fires each automatic reminder once and stops after completion', () => {
  const event = Date.UTC(2026, 6, 19, 10, 0);
  const at30 = dueReminders(task, event - 30 * 60000);
  assert.deepEqual(at30.map((r) => r.minutes), [30]);
  assert.deepEqual(dueReminders(task, event - 15 * 60000, new Set(at30.map((r) => r.key))).map((r) => r.minutes), [15]);
  assert.deepEqual(dueReminders(task, event, new Set([at30[0].key, `${task.file}#${task.line}#${task.date}#${task.time}#15`])).map((r) => r.minutes), [0]);
  assert.deepEqual(dueReminders({ ...task, done: true }, event), []);
});
