const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/index.js');
const { createDb } = require('../server/db.js');

const config = {
  businessName: 'Acme HVAC',
  hours: null,
  serviceArea: null,
  pricing: null,
  services: [],
  branding: { primaryColor: '#111', accentColor: '#222', logoUrl: null },
  owner: { notificationEmail: 'owner@acme.com', notificationPhone: null }
};

function freshDb() {
  return createDb(path.join(os.tmpdir(), `lead-test-${Date.now()}-${Math.random()}.sqlite`));
}

function workingClients() {
  return {
    resendClient: { emails: { send: async () => ({ data: { id: 'e1' } }) } },
    twilioClient: { messages: { create: async () => ({ sid: 'SM1' }) } }
  };
}

test('happy path: lead saved, email sent, sms sent', async () => {
  const db = freshDb();
  const { resendClient, twilioClient } = workingClients();
  const app = createApp({ config, db, resendClient, twilioClient, fromEmail: 'leads@x.com', fromNumber: '+15125550199' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    const row = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(body.leadId);
    assert.equal(row.name, 'Jane');
    assert.equal(row.email_sent, 1);
    assert.equal(row.sms_sent, 1);
  } finally {
    server.close();
  }
});

test('simulated SMS failure: lead still saved, still emailed, response still ok', async () => {
  const db = freshDb();
  const { resendClient } = workingClients();
  const failingTwilioClient = { messages: { create: async () => { throw new Error('simulated Twilio outage'); } } };
  const app = createApp({ config, db, resendClient, twilioClient: failingTwilioClient, fromEmail: 'leads@x.com', fromNumber: '+15125550199' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's2', name: 'Bob', phone: '+15125550101', reason: 'no heat' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    const row = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(body.leadId);
    assert.equal(row.name, 'Bob');
    assert.equal(row.email_sent, 1);
    assert.equal(row.sms_sent, 0);
  } finally {
    server.close();
  }
});

test('simulated email failure: lead still saved, sms still attempted, response still ok', async () => {
  const db = freshDb();
  const { twilioClient } = workingClients();
  const failingResendClient = { emails: { send: async () => { throw new Error('simulated Resend outage'); } } };
  const app = createApp({ config, db, resendClient: failingResendClient, twilioClient, fromEmail: 'leads@x.com', fromNumber: '+15125550199' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's3', name: 'Sue', phone: '+15125550102', reason: 'thermostat broken' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    const row = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(body.leadId);
    assert.equal(row.email_sent, 0);
    assert.equal(row.sms_sent, 1);
  } finally {
    server.close();
  }
});

test('missing required fields returns 400 and does not create a lead row', async () => {
  const db = freshDb();
  const { resendClient, twilioClient } = workingClients();
  const app = createApp({ config, db, resendClient, twilioClient, fromEmail: 'leads@x.com', fromNumber: '+15125550199' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's4', name: 'NoPhone' })
    });
    assert.equal(res.status, 400);
    const count = db.raw.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
    assert.equal(count, 0);
  } finally {
    server.close();
  }
});

test('markLeadNotified failure after successful save returns 200 ok (regression test)', async () => {
  const db = freshDb();
  const { resendClient, twilioClient } = workingClients();

  // Spy on markLeadNotified to make it throw
  const originalMarkLeadNotified = db.markLeadNotified;
  db.markLeadNotified = () => {
    throw new Error('simulated markLeadNotified outage');
  };

  const app = createApp({ config, db, resendClient, twilioClient, fromEmail: 'leads@x.com', fromNumber: '+15125550199' });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's5', name: 'Mark', phone: '+15125550103', reason: 'need repair' })
    });
    const body = await res.json();
    // Despite markLeadNotified throwing, response must still be 200 ok
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert(body.leadId);
    // Lead must still be saved
    const row = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(body.leadId);
    assert.equal(row.name, 'Mark');
  } finally {
    server.close();
  }
});
