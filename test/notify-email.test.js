// test/notify-email.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendLeadEmail } = require('../server/services/notify-email.js');

const config = { businessName: 'Acme HVAC', owner: { notificationEmail: 'owner@acme.com', notificationPhone: null } };
const lead = { name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' };

test('sends email successfully', async () => {
  let captured = null;
  const resendClient = { emails: { send: async (args) => { captured = args; return { data: { id: 'abc' } }; } } };
  const result = await sendLeadEmail({ resendClient, config, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, true);
  assert.equal(captured.to, 'owner@acme.com');
  assert.match(captured.subject, /Acme HVAC/);
  assert.match(captured.text, /Jane/);
});

test('missing owner email returns ok:false without throwing', async () => {
  const cfgNoEmail = { businessName: 'Acme HVAC', owner: { notificationEmail: null, notificationPhone: null } };
  const resendClient = { emails: { send: async () => ({ data: { id: 'abc' } }) } };
  const result = await sendLeadEmail({ resendClient, config: cfgNoEmail, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, false);
  assert.match(result.error, /no owner email/i);
});

test('Resend API returns {error} (v4 contract) -> returns ok:false without throwing', async () => {
  const resendClient = { emails: { send: async () => ({ data: null, error: { message: 'resend down' } }) } };
  const result = await sendLeadEmail({ resendClient, config, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, false);
  assert.match(result.error, /resend down/);
});

test('Resend SDK call genuinely throws (e.g. network-layer failure) -> returns ok:false without throwing', async () => {
  const resendClient = { emails: { send: async () => { throw new Error('resend network failure'); } } };
  const result = await sendLeadEmail({ resendClient, config, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, false);
  assert.match(result.error, /resend network failure/);
});

test('missing resendClient (e.g. no API key configured) returns ok:false without throwing', async () => {
  const result = await sendLeadEmail({ resendClient: null, config, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, false);
});
