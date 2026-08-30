// test/hours.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isOpenNow } = require('../server/services/hours.js');

test('null hours (missing/malformed) fails open', () => {
  assert.equal(isOpenNow(null), true);
});

test('open during scheduled window', () => {
  const hours = {
    display: 'Mon 8-18',
    timezone: 'UTC',
    schedule: { monday: { open: '08:00', close: '18:00' } }
  };
  // 2026-08-31 is a Monday, noon UTC
  const now = new Date('2026-08-31T12:00:00.000Z');
  assert.equal(isOpenNow(hours, now), true);
});

test('closed outside scheduled window', () => {
  const hours = {
    display: 'Mon 8-18',
    timezone: 'UTC',
    schedule: { monday: { open: '08:00', close: '18:00' } }
  };
  const now = new Date('2026-08-31T20:00:00.000Z'); // Monday 8pm UTC
  assert.equal(isOpenNow(hours, now), false);
});

test('day not present in schedule (e.g. Sunday closed) returns false', () => {
  const hours = {
    display: 'Mon 8-18',
    timezone: 'UTC',
    schedule: { monday: { open: '08:00', close: '18:00' } }
  };
  const now = new Date('2026-08-30T12:00:00.000Z'); // Sunday
  assert.equal(isOpenNow(hours, now), false);
});

test('day explicitly null in schedule returns false (closed that day)', () => {
  const hours = {
    display: 'Closed Sundays',
    timezone: 'UTC',
    schedule: { monday: { open: '08:00', close: '18:00' }, sunday: null }
  };
  const now = new Date('2026-08-30T12:00:00.000Z'); // Sunday
  assert.equal(isOpenNow(hours, now), false);
});

test('invalid timezone in an otherwise-valid hours object fails open rather than throwing', () => {
  const hours = {
    display: 'Mon 8-18',
    timezone: 'Not/ARealZone',
    schedule: { monday: { open: '08:00', close: '18:00' } }
  };
  assert.doesNotThrow(() => isOpenNow(hours, new Date('2026-08-31T12:00:00.000Z')));
});
