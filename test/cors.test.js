// test/cors.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index.js');

const config = {
  businessName: 'Acme HVAC',
  hours: null,
  serviceArea: null,
  pricing: null,
  services: [],
  branding: { primaryColor: '#111', accentColor: '#222', logoUrl: null }
};

test('GET /api/config sends Access-Control-Allow-Origin so cross-origin widgets can call the API', async () => {
  const app = createApp({ config });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/config`, {
      headers: { Origin: 'https://some-client-site.example.com' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  } finally {
    server.close();
  }
});

test('OPTIONS preflight on /api/config is handled with CORS headers', async () => {
  const app = createApp({ config });
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/config`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://some-client-site.example.com',
        'Access-Control-Request-Method': 'GET'
      }
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  } finally {
    server.close();
  }
});
