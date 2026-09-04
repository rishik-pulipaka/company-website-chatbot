const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailer } = require('../server/services/mailer.js');

test('createMailer returns null when no API key is configured', () => {
  assert.equal(createMailer({}), null);
  assert.equal(createMailer({ BREVO_API_KEY: '' }), null);
});

test('createMailer returns an object with a sendMail method when a key is set', () => {
  const mailer = createMailer({ BREVO_API_KEY: 'xkeysib-test-key' });
  assert.equal(typeof mailer.sendMail, 'function');
});

test('sendMail posts to Brevo with the expected shape and resolves on 2xx', async () => {
  const originalFetch = global.fetch;
  let captured = null;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 201 };
  };
  try {
    const mailer = createMailer({ BREVO_API_KEY: 'xkeysib-test-key' });
    await mailer.sendMail({ from: 'me@x.com', to: 'owner@acme.com', subject: 'Hi', text: 'Body' });
    assert.equal(captured.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(captured.options.headers['api-key'], 'xkeysib-test-key');
    const body = JSON.parse(captured.options.body);
    assert.equal(body.sender.email, 'me@x.com');
    assert.equal(body.to[0].email, 'owner@acme.com');
    assert.equal(body.subject, 'Hi');
    assert.equal(body.textContent, 'Body');
  } finally {
    global.fetch = originalFetch;
  }
});

test('sendMail throws with detail on a non-2xx response', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'invalid api key' })
  });
  try {
    const mailer = createMailer({ BREVO_API_KEY: 'bad-key' });
    await assert.rejects(
      () => mailer.sendMail({ from: 'me@x.com', to: 'owner@acme.com', subject: 'Hi', text: 'Body' }),
      /invalid api key/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
