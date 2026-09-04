// test/monthly-recap.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../server/db.js');
const { runMonthlyRecapIfDue } = require('../server/jobs/monthly-recap.js');

const config = { businessName: 'Acme HVAC', owner: { notificationEmail: 'owner@acme.com', notificationPhone: null } };

function freshDb() {
  return createDb(path.join(os.tmpdir(), `recap-test-${Date.now()}-${Math.random()}.sqlite`));
}

test('sends a recap covering the previous full month, with real counts', async () => {
  const db = freshDb();
  // Insert data timestamped in July 2026 by manipulating started_at/created_at directly.
  const convId = db.insertConversation('s1');
  db.raw.prepare("UPDATE conversations SET started_at = '2026-07-15T10:00:00.000Z' WHERE id = ?").run(convId);
  const leadId = db.insertLead({ conversationId: convId, name: 'Jane', phone: '1', reason: 'r' });
  db.raw.prepare("UPDATE leads SET created_at = '2026-07-15T10:00:00.000Z' WHERE id = ?").run(leadId);

  let captured = null;
  const mailer = { sendMail: async (args) => { captured = args; return { messageId: 'e1' }; } };

  const result = await runMonthlyRecapIfDue({
    db,
    config,
    mailer,
    fromEmail: 'me@gmail.com',
    now: new Date('2026-08-01T06:00:00.000Z')
  });

  assert.equal(result.sent, true);
  assert.match(captured.text, /1 conversation/i);
  assert.match(captured.text, /1 lead/i);
});

test('does not send twice for the same month', async () => {
  const db = freshDb();
  const mailer = { sendMail: async () => ({ messageId: 'e1' }) };
  const now = new Date('2026-08-01T06:00:00.000Z');

  const first = await runMonthlyRecapIfDue({ db, config, mailer, fromEmail: 'me@gmail.com', now });
  const second = await runMonthlyRecapIfDue({ db, config, mailer, fromEmail: 'me@gmail.com', now });

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.match(second.reason, /already sent/i);
});

test('send failure (SMTP throws): does not mark month as sent, allows retry', async () => {
  const db = freshDb();
  const mailer = { sendMail: async () => { throw new Error('smtp network failure'); } };
  const now = new Date('2026-08-01T06:00:00.000Z');

  const result = await runMonthlyRecapIfDue({ db, config, mailer, fromEmail: 'me@gmail.com', now });

  assert.equal(result.sent, false);
  assert.match(result.reason, /smtp network failure/);
  assert.equal(db.hasRecapBeenSent('2026-07'), false);
});

test('missing owner email does not throw, reports not sent', async () => {
  const db = freshDb();
  const cfgNoEmail = { businessName: 'Acme HVAC', owner: { notificationEmail: null, notificationPhone: null } };
  const mailer = { sendMail: async () => ({ messageId: 'e1' }) };
  const result = await runMonthlyRecapIfDue({
    db,
    config: cfgNoEmail,
    mailer,
    fromEmail: 'me@gmail.com',
    now: new Date('2026-08-01T06:00:00.000Z')
  });
  assert.equal(result.sent, false);
});
