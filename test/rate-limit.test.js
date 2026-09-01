const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/index.js');
const { createDb } = require('../server/db.js');

const config = {
  businessName: 'Acme HVAC',
  hours: { display: 'Mon-Fri 8am-6pm', timezone: 'UTC', schedule: {} },
  serviceArea: 'Austin metro',
  pricing: '$99 diagnostic',
  services: ['AC repair'],
  branding: { primaryColor: '#111', accentColor: '#222', logoUrl: null },
  owner: { notificationEmail: 'o@x.com', notificationPhone: null }
};

function fakeClient() {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ inScope: true, answer: 'ok' }) }] })
    }
  };
}

function freshDb() {
  return createDb(path.join(os.tmpdir(), `ratelimit-test-${Date.now()}-${Math.random()}.sqlite`));
}

test('POST /api/chat returns 429 once the per-IP rate limit is exceeded', async () => {
  const db = freshDb();
  // Inject a very small limit so the test runs fast and deterministically.
  const app = createApp({
    config,
    db,
    anthropicClient: fakeClient(),
    model: 'fake',
    rateLimit: { windowMs: 60_000, max: 3 }
  });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const makeRequest = () =>
      fetch(`http://localhost:${port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'rl-1', message: 'hello' })
      });

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await makeRequest());
    }

    const statuses = results.map((r) => r.status);
    assert.ok(statuses.includes(200), `expected some 200s, got ${statuses}`);
    assert.ok(statuses.includes(429), `expected a 429 after exceeding the limit, got ${statuses}`);

    const limited = results.find((r) => r.status === 429);
    const body = await limited.json();
    assert.equal(body.error, 'Too many requests, please try again shortly.');
  } finally {
    server.close();
  }
});

test('POST /api/lead returns 429 once the per-IP rate limit is exceeded', async () => {
  const db = freshDb();
  const app = createApp({
    config,
    db,
    resendClient: { emails: { send: async () => ({ data: { id: 'e1' } }) } },
    twilioClient: { messages: { create: async () => ({ sid: 'SM1' }) } },
    fromEmail: 'leads@x.com',
    fromNumber: '+15125550199',
    rateLimit: { windowMs: 60_000, max: 3 }
  });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const makeRequest = (i) =>
      fetch(`http://localhost:${port}/api/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: `rl-lead-${i}`, name: 'Rate Limit', phone: '+15125550100', reason: 'test' })
      });

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await makeRequest(i));
    }

    const statuses = results.map((r) => r.status);
    assert.ok(statuses.includes(200), `expected some 200s, got ${statuses}`);
    assert.ok(statuses.includes(429), `expected a 429 after exceeding the limit, got ${statuses}`);
  } finally {
    server.close();
  }
});

test('rate limits are independent per route: chat limit does not block lead requests', async () => {
  const db = freshDb();
  const app = createApp({
    config,
    db,
    anthropicClient: fakeClient(),
    model: 'fake',
    resendClient: { emails: { send: async () => ({ data: { id: 'e1' } }) } },
    twilioClient: { messages: { create: async () => ({ sid: 'SM1' }) } },
    fromEmail: 'leads@x.com',
    fromNumber: '+15125550199',
    rateLimit: { windowMs: 60_000, max: 2 }
  });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    // Trip the chat limiter.
    for (let i = 0; i < 4; i++) {
      await fetch(`http://localhost:${port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'rl-2', message: 'hello' })
      });
    }

    // Lead requests come from a shared limiter keyed by /api/lead specifically,
    // so it has its own budget separate from /api/chat's.
    const leadRes = await fetch(`http://localhost:${port}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'rl-3', name: 'Independent', phone: '+15125550100', reason: 'test' })
    });
    assert.equal(leadRes.status, 200);
  } finally {
    server.close();
  }
});
