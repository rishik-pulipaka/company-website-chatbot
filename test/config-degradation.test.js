const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/index.js');
const { loadConfig } = require('../server/config-loader.js');
const { createDb } = require('../server/db.js');

function writeTmpConfig(obj) {
  const file = path.join(os.tmpdir(), `degrade-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(file, JSON.stringify(obj));
  return file;
}

function freshDb() {
  return createDb(path.join(os.tmpdir(), `degrade-db-${Date.now()}-${Math.random()}.sqlite`));
}

async function startAppFor(configFile) {
  const config = loadConfig(configFile);
  const db = freshDb();
  const app = createApp({ config, db });
  const server = app.listen(0);
  return { server, port: server.address().port, config };
}

test('missing hours field: server starts, config route reports open, no crash', async () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC' });
  const { server, port } = await startAppFor(file);
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.isOpenNow, true);
    assert.equal(body.hours.display, null);
  } finally {
    server.close();
  }
});

test('malformed hours.schedule: server starts, falls back to always-open', async () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC', hours: { schedule: 'not-an-object' } });
  const { server, port } = await startAppFor(file);
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    const body = await res.json();
    assert.equal(body.isOpenNow, true);
  } finally {
    server.close();
  }
});

test('missing branding: server starts, returns default theme colors', async () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC' });
  const { server, port } = await startAppFor(file);
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    const body = await res.json();
    assert.equal(body.branding.primaryColor, '#0b1f3a');
    assert.equal(body.branding.accentColor, '#d9603b');
  } finally {
    server.close();
  }
});

test('missing logoUrl: server starts, returns null logoUrl (widget renders text-only header)', async () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC', branding: { primaryColor: '#000', accentColor: '#fff' } });
  const { server, port } = await startAppFor(file);
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    const body = await res.json();
    assert.equal(body.branding.logoUrl, null);
  } finally {
    server.close();
  }
});

test('missing pricing: server starts, /api/config returns null pricing without error', async () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC' });
  const { server, port } = await startAppFor(file);
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    const body = await res.json();
    assert.equal(body.pricing, null);
  } finally {
    server.close();
  }
});

test('completely empty config object: server still starts and serves /api/health and /api/config', async () => {
  const file = writeTmpConfig({});
  const { server, port } = await startAppFor(file);
  try {
    const health = await fetch(`http://localhost:${port}/api/health`);
    const cfg = await fetch(`http://localhost:${port}/api/config`);
    assert.equal(health.status, 200);
    assert.equal(cfg.status, 200);
  } finally {
    server.close();
  }
});

test('malformed JSON file entirely: server still starts using safe defaults', async () => {
  const file = path.join(os.tmpdir(), `bad-${Date.now()}.json`);
  fs.writeFileSync(file, '{ not valid json');
  const { server, port } = await startAppFor(file);
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});
