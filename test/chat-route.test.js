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

function fakeClient(inScope, answer) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ inScope, answer }) }] })
    }
  };
}

function freshDb() {
  return createDb(path.join(os.tmpdir(), `chat-test-${Date.now()}-${Math.random()}.sqlite`));
}

test('POST /api/chat returns an in-scope answer and logs the exchange', async () => {
  const db = freshDb();
  const app = createApp({ config, db, anthropicClient: fakeClient(true, 'We are open Mon-Fri 8am-6pm.'), model: 'fake' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', message: 'what are your hours' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.inScope, true);
    assert.match(body.answer, /8am-6pm/);

    const convId = db.insertConversation('s1');
    const missed = db.raw.prepare('SELECT * FROM missed_questions WHERE conversation_id = ?').all(convId);
    assert.equal(missed.length, 0);
    const messages = db.raw.prepare('SELECT * FROM messages WHERE conversation_id = ?').all(convId);
    assert.equal(messages.length, 2); // user + assistant
  } finally {
    server.close();
  }
});

test('POST /api/chat logs a missed question when out of scope', async () => {
  const db = freshDb();
  const app = createApp({ config, db, anthropicClient: fakeClient(false, ''), model: 'fake' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's2', message: 'do you install pools' })
    });
    const body = await res.json();
    assert.equal(body.inScope, false);

    const convId = db.insertConversation('s2');
    const missed = db.raw.prepare('SELECT * FROM missed_questions WHERE conversation_id = ?').all(convId);
    assert.equal(missed.length, 1);
    assert.equal(missed[0].question_text, 'do you install pools');
  } finally {
    server.close();
  }
});

test('POST /api/chat with missing message returns 400', async () => {
  const db = freshDb();
  const app = createApp({ config, db, anthropicClient: fakeClient(true, 'x'), model: 'fake' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's3' })
    });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});
