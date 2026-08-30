const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../server/db.js');

function tmpDbPath() {
  return path.join(os.tmpdir(), `test-${Date.now()}-${Math.random()}.sqlite`);
}

test('creates schema and inserts a conversation idempotently', () => {
  const db = createDb(tmpDbPath());
  const id1 = db.insertConversation('session-1');
  const id2 = db.insertConversation('session-1');
  assert.equal(id1, id2);
  const id3 = db.insertConversation('session-2');
  assert.notEqual(id1, id3);
});

test('inserts messages and missed questions linked to a conversation', () => {
  const db = createDb(tmpDbPath());
  const convId = db.insertConversation('session-1');
  const msgId = db.insertMessage({ conversationId: convId, role: 'user', text: 'hi', answeredFromConfig: null });
  assert.ok(msgId > 0);
  const missedId = db.insertMissedQuestion({ conversationId: convId, questionText: 'do you install pools?' });
  assert.ok(missedId > 0);
  const row = db.raw.prepare('SELECT * FROM missed_questions WHERE id = ?').get(missedId);
  assert.equal(row.question_text, 'do you install pools?');
});

test('inserts a lead and marks notification status', () => {
  const db = createDb(tmpDbPath());
  const convId = db.insertConversation('session-1');
  const leadId = db.insertLead({ conversationId: convId, name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' });
  assert.ok(leadId > 0);
  db.markLeadNotified({ leadId, emailSent: true, smsSent: false });
  const row = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  assert.equal(row.email_sent, 1);
  assert.equal(row.sms_sent, 0);
});

test('getRecapStats counts conversations and leads in a date range', () => {
  const db = createDb(tmpDbPath());
  const conv1 = db.insertConversation('s1');
  db.insertConversation('s2');
  db.insertLead({ conversationId: conv1, name: 'A', phone: '1', reason: 'r' });
  const stats = db.getRecapStats({ sinceIso: '2000-01-01T00:00:00.000Z', untilIso: '2999-01-01T00:00:00.000Z' });
  assert.equal(stats.conversationCount, 2);
  assert.equal(stats.leadCount, 1);
});

test('recap-sent tracking prevents duplicate sends for the same month', () => {
  const db = createDb(tmpDbPath());
  assert.equal(db.hasRecapBeenSent('2026-07'), false);
  db.markRecapSent('2026-07');
  assert.equal(db.hasRecapBeenSent('2026-07'), true);
});

test('creates parent directory for the db file if missing', () => {
  const dir = path.join(os.tmpdir(), `test-dir-${Date.now()}`);
  const dbPath = path.join(dir, 'nested', 'leads.sqlite');
  assert.doesNotThrow(() => createDb(dbPath));
  assert.ok(fs.existsSync(dbPath));
});
