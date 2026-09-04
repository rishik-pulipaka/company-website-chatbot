const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailer } = require('../server/services/mailer.js');

test('createMailer returns null when no API key is configured', () => {
  assert.equal(createMailer({}), null);
  assert.equal(createMailer({ SENDGRID_API_KEY: '' }), null);
});

test('createMailer returns an object with a sendMail method when a key is set', () => {
  const mailer = createMailer({ SENDGRID_API_KEY: 'SG.test-key' });
  assert.equal(typeof mailer.sendMail, 'function');
});
