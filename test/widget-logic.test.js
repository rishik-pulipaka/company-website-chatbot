const test = require('node:test');
const assert = require('node:assert/strict');
const { formatGreeting, buildQuickReplyAnswer } = require('../widget/widget.js');

test('formatGreeting: open business gets the standard greeting', () => {
  const config = { businessName: 'Acme HVAC', isOpenNow: true };
  const greeting = formatGreeting(config);
  assert.match(greeting, /Acme HVAC/);
  assert.doesNotMatch(greeting, /closed/i);
});

test('formatGreeting: closed business acknowledges being closed but still offers help', () => {
  const config = { businessName: 'Acme HVAC', isOpenNow: false };
  const greeting = formatGreeting(config);
  assert.match(greeting, /closed/i);
  assert.match(greeting, /still (help|assist)/i);
});

test('buildQuickReplyAnswer: hours', () => {
  const config = { hours: { display: 'Mon-Fri 8-6' } };
  assert.match(buildQuickReplyAnswer(config, 'hours'), /Mon-Fri 8-6/);
});

test('buildQuickReplyAnswer: hours missing falls back to a safe message', () => {
  const config = { hours: { display: null } };
  assert.match(buildQuickReplyAnswer(config, 'hours'), /contact us|let us know/i);
});

test('buildQuickReplyAnswer: serviceArea', () => {
  const config = { serviceArea: 'Austin metro' };
  assert.match(buildQuickReplyAnswer(config, 'serviceArea'), /Austin metro/);
});

test('buildQuickReplyAnswer: pricing', () => {
  const config = { pricing: '$99 diagnostic' };
  assert.match(buildQuickReplyAnswer(config, 'pricing'), /\$99/);
});
