// test/notify-email.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendLeadEmail } = require('../server/services/notify-email.js');

const config = { businessName: 'Acme HVAC', owner: { notificationEmail: 'owner@acme.com', notificationPhone: null } };
const lead = { name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' };

test('sends email successfully', async () => {
  let captured = null;
  const mailer = { sendMail: async (args) => { captured = args; return { messageId: 'abc' }; } };
  const result = await sendLeadEmail({ mailer, config, lead, fromEmail: 'me@gmail.com' });
  assert.equal(result.ok, true);
  assert.equal(captured.to, 'owner@acme.com');
  assert.equal(captured.from, 'me@gmail.com');
  assert.match(captured.subject, /Acme HVAC/);
  assert.match(captured.text, /Jane/);
});

test('missing owner email returns ok:false without throwing', async () => {
  const cfgNoEmail = { businessName: 'Acme HVAC', owner: { notificationEmail: null, notificationPhone: null } };
  const mailer = { sendMail: async () => ({ messageId: 'abc' }) };
  const result = await sendLeadEmail({ mailer, config: cfgNoEmail, lead, fromEmail: 'me@gmail.com' });
  assert.equal(result.ok, false);
  assert.match(result.error, /no owner email/i);
});

test('mailer throws (SMTP failure) -> returns ok:false without throwing', async () => {
  const mailer = { sendMail: async () => { throw new Error('smtp auth failed'); } };
  const result = await sendLeadEmail({ mailer, config, lead, fromEmail: 'me@gmail.com' });
  assert.equal(result.ok, false);
  assert.match(result.error, /smtp auth failed/);
});

test('missing mailer (no SMTP creds configured) returns ok:false without throwing', async () => {
  const result = await sendLeadEmail({ mailer: null, config, lead, fromEmail: 'me@gmail.com' });
  assert.equal(result.ok, false);
});
