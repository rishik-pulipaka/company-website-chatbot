// test/config-loader.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../server/config-loader.js');

function writeTmpConfig(obj) {
  const file = path.join(os.tmpdir(), `cfg-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return file;
}

test('loads a valid full config as-is', () => {
  const file = writeTmpConfig({
    businessName: 'Acme HVAC',
    hours: {
      display: 'Mon-Fri 8am-6pm',
      timezone: 'America/Chicago',
      schedule: { monday: { open: '08:00', close: '18:00' } }
    },
    serviceArea: 'Austin metro',
    pricing: '$99 diagnostic, repairs vary',
    services: ['AC repair', 'Furnace install'],
    branding: { primaryColor: '#111111', accentColor: '#eeeeee', logoUrl: 'https://x/logo.png' },
    owner: { notificationEmail: 'owner@acme.com', notificationPhone: '+15125550100' }
  });
  const cfg = loadConfig(file);
  assert.equal(cfg.businessName, 'Acme HVAC');
  assert.equal(cfg.hours.display, 'Mon-Fri 8am-6pm');
  assert.equal(cfg.branding.primaryColor, '#111111');
  assert.equal(cfg.owner.notificationEmail, 'owner@acme.com');
});

test('missing hours defaults to null (always-open fail-safe)', () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC' });
  const cfg = loadConfig(file);
  assert.equal(cfg.hours, null);
});

test('malformed hours (schedule not an object) falls back to null hours', () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC', hours: { schedule: 'not-an-object' } });
  const cfg = loadConfig(file);
  assert.equal(cfg.hours, null);
});

test('missing branding defaults to navy/terracotta theme', () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC' });
  const cfg = loadConfig(file);
  assert.equal(cfg.branding.primaryColor, '#0b1f3a');
  assert.equal(cfg.branding.accentColor, '#d9603b');
  assert.equal(cfg.branding.logoUrl, null);
});

test('missing pricing/serviceArea/services default to null/empty', () => {
  const file = writeTmpConfig({ businessName: 'Acme HVAC' });
  const cfg = loadConfig(file);
  assert.equal(cfg.pricing, null);
  assert.equal(cfg.serviceArea, null);
  assert.deepEqual(cfg.services, []);
});

test('missing businessName defaults instead of throwing', () => {
  const file = writeTmpConfig({});
  const cfg = loadConfig(file);
  assert.equal(cfg.businessName, 'Our Company');
});

test('unreadable/invalid JSON file falls back to a fully-safe default config, never throws', () => {
  const file = writeTmpConfig('{ this is not valid json');
  assert.doesNotThrow(() => loadConfig(file));
  const cfg = loadConfig(file);
  assert.equal(cfg.businessName, 'Our Company');
  assert.equal(cfg.hours, null);
});

test('missing file falls back to a fully-safe default config, never throws', () => {
  assert.doesNotThrow(() => loadConfig('/nonexistent/path/client-config.json'));
  const cfg = loadConfig('/nonexistent/path/client-config.json');
  assert.equal(cfg.businessName, 'Our Company');
});
