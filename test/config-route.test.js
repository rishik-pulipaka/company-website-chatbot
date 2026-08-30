const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index.js');

function sampleConfig(overrides = {}) {
  return {
    businessName: 'Acme HVAC',
    hours: { display: 'Mon-Fri 8-6', timezone: 'UTC', schedule: { monday: { open: '00:00', close: '23:59' } } },
    serviceArea: 'Austin metro',
    pricing: '$99 diagnostic',
    services: ['AC repair'],
    branding: { primaryColor: '#111', accentColor: '#222', logoUrl: null },
    owner: { notificationEmail: 'owner@acme.com', notificationPhone: null },
    ...overrides
  };
}

test('GET /api/config returns public-safe fields and never leaks owner info', async () => {
  const app = createApp({ config: sampleConfig() });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.businessName, 'Acme HVAC');
    assert.equal(body.hours.display, 'Mon-Fri 8-6');
    assert.equal(typeof body.isOpenNow, 'boolean');
    assert.equal(body.owner, undefined);
  } finally {
    server.close();
  }
});

test('GET /api/config with null hours reports isOpenNow true and display null', async () => {
  const app = createApp({ config: sampleConfig({ hours: null }) });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/config`);
    const body = await res.json();
    assert.equal(body.isOpenNow, true);
    assert.equal(body.hours.display, null);
  } finally {
    server.close();
  }
});
