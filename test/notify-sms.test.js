const test = require('node:test');
const assert = require('node:assert/strict');
const { sendLeadSms } = require('../server/services/notify-sms.js');

const config = { businessName: 'Acme HVAC' };
const lead = { name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' };

test('sends sms successfully', async () => {
  let captured = null;
  const twilioClient = { messages: { create: async (args) => { captured = args; return { sid: 'SM123' }; } } };
  const result = await sendLeadSms({ twilioClient, config, lead, fromNumber: '+15125550199' });
  assert.equal(result.ok, true);
  assert.equal(captured.to, '+15125550100');
  assert.match(captured.body, /Jane/);
  assert.match(captured.body, /Acme HVAC/);
});

test('uses messagingServiceSid instead of from when one is provided', async () => {
  let captured = null;
  const twilioClient = { messages: { create: async (args) => { captured = args; return { sid: 'SM123' }; } } };
  const result = await sendLeadSms({
    twilioClient,
    config,
    lead,
    fromNumber: '+15125550199',
    messagingServiceSid: 'MG0000000000000000000000000000000'
  });
  assert.equal(result.ok, true);
  assert.equal(captured.messagingServiceSid, 'MG0000000000000000000000000000000');
  assert.equal(captured.from, undefined);
});

test('Twilio API failure returns ok:false without throwing (simulated SMS failure)', async () => {
  const twilioClient = { messages: { create: async () => { throw new Error('simulated Twilio outage'); } } };
  const result = await sendLeadSms({ twilioClient, config, lead, fromNumber: '+15125550199' });
  assert.equal(result.ok, false);
  assert.match(result.error, /simulated Twilio outage/);
});

test('missing twilioClient returns ok:false without throwing', async () => {
  const result = await sendLeadSms({ twilioClient: null, config, lead, fromNumber: '+15125550199' });
  assert.equal(result.ok, false);
});
