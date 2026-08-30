const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Anthropic } = require('@anthropic-ai/sdk');
const { loadConfig } = require('../server/config-loader.js');
const { answerQuestion } = require('../server/services/faq.js');

const configPath = path.join(__dirname, '..', 'client-config.example.json');
const config = loadConfig(configPath);
const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const hasKey = !!process.env.ANTHROPIC_API_KEY;

const cases = [
  { q: 'what are your hours', mustMatch: /8:00\s*am|8am|Mon-Fri/i, inScope: true },
  { q: 'when are you open', mustMatch: /8:00\s*am|8am|Mon-Fri/i, inScope: true },
  { q: 'do you work weekends', mustMatch: /Saturday|Sat/i, inScope: true },
  { q: 'what do you do', mustMatch: /AC|furnace|HVAC/i, inScope: true },
  { q: 'what services do you offer', mustMatch: /AC|furnace|duct/i, inScope: true },
  { q: 'how much does it cost', mustMatch: /\$99|\$150|diagnostic/i, inScope: true },
  { q: 'is this expensive', mustMatch: /\$99|\$150|diagnostic/i, inScope: true },
  { q: 'do you service my area', mustMatch: /Austin|25.?mile/i, inScope: true },
  { q: 'are you near me', mustMatch: /Austin|25.?mile/i, inScope: true }
];

test('client-config.example.json exists and loads', () => {
  assert.ok(fs.existsSync(configPath));
  assert.equal(config.businessName, 'Lone Star Comfort Heating & Air');
});

for (const { q, mustMatch, inScope } of cases) {
  test(`free-text phrasing: "${q}"`, { skip: !hasKey && 'ANTHROPIC_API_KEY not set; skipping live-model reliability check' }, async () => {
    const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await answerQuestion({ config, message: q, anthropicClient, model });
    assert.equal(result.inScope, inScope, `expected in-scope answer for "${q}", got: ${JSON.stringify(result)}`);
    assert.match(result.answer, mustMatch, `answer for "${q}" did not contain expected grounded content: ${result.answer}`);
  });
}
