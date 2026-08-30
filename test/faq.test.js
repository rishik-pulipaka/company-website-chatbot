// test/faq.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { answerQuestion } = require('../server/services/faq.js');

const config = {
  businessName: 'Acme HVAC',
  hours: { display: 'Mon-Fri 8am-6pm, Sat 9am-2pm', timezone: 'America/Chicago', schedule: {} },
  serviceArea: 'Austin metro, 25 mile radius',
  pricing: '$99 diagnostic fee, most repairs $150-$600',
  services: ['AC repair', 'Furnace installation', 'Duct cleaning']
};

function fakeClient(responseText) {
  return {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: responseText }] })
    }
  };
}

test('parses a well-formed in-scope JSON response', async () => {
  const client = fakeClient(JSON.stringify({ inScope: true, answer: 'We are open Mon-Fri 8am-6pm, Sat 9am-2pm.' }));
  const result = await answerQuestion({ config, message: 'what are your hours', anthropicClient: client, model: 'fake-model' });
  assert.equal(result.inScope, true);
  assert.match(result.answer, /8am-6pm/);
});

test('parses an out-of-scope JSON response', async () => {
  const client = fakeClient(JSON.stringify({ inScope: false, answer: '' }));
  const result = await answerQuestion({ config, message: 'do you install pools', anthropicClient: client, model: 'fake-model' });
  assert.equal(result.inScope, false);
});

test('unparseable model response falls back to out-of-scope, does not throw', async () => {
  const client = fakeClient('not json at all');
  const result = await answerQuestion({ config, message: 'anything', anthropicClient: client, model: 'fake-model' });
  assert.equal(result.inScope, false);
  assert.equal(typeof result.answer, 'string');
});

test('Anthropic API error falls back to out-of-scope, does not throw', async () => {
  const client = { messages: { create: async () => { throw new Error('network down'); } } };
  const result = await answerQuestion({ config, message: 'anything', anthropicClient: client, model: 'fake-model' });
  assert.equal(result.inScope, false);
  assert.equal(typeof result.answer, 'string');
});

test('system prompt includes only the provided config fields', async () => {
  let capturedSystem = null;
  const client = {
    messages: {
      create: async (args) => {
        capturedSystem = args.system;
        return { content: [{ type: 'text', text: JSON.stringify({ inScope: true, answer: 'ok' }) }] };
      }
    }
  };
  await answerQuestion({ config, message: 'what services', anthropicClient: client, model: 'fake-model' });
  assert.match(capturedSystem, /Acme HVAC/);
  assert.match(capturedSystem, /Austin metro/);
  assert.match(capturedSystem, /never invent/i);
});
