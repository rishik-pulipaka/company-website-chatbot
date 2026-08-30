# HVAC Website Chatbot v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resellable, embeddable HVAC website chat widget (v1): grounded FAQ answering via Claude Haiku, lead capture with independent save/email/SMS, after-hours-aware greeting, monthly recap email, missed-question log, and a one-file-per-client reskin/redeploy workflow.

**Architecture:** Node/Express backend serving both a JSON API and the widget's static JS/CSS; SQLite (`better-sqlite3`) for leads/conversations/missed-questions; a single `client-config.json` drives branding, hours, and FAQ content; the widget embeds via one `<script>` tag into a Shadow DOM root so it never collides with a host site's CSS/JS. One deployed instance per client (Railway), no multi-tenancy in code.

**Tech Stack:** Node.js (>=18) + Express, better-sqlite3, @anthropic-ai/sdk (Claude Haiku), resend (email), twilio (SMS), node-cron, dotenv. No frontend framework. Node's built-in `node:test` + `node:assert` for tests (no extra test dependency).

**Spec:** `docs/superpowers/specs/2026-08-30-hvac-chatbot-design.md`

## Global Constraints

- One Railway service per client; no multi-tenant logic in code (spec: Architecture).
- Storage is SQLite via `better-sqlite3` on a persistent volume; file path from `DATA_DB_PATH` env (spec: Decisions).
- Email via Resend, SMS via Twilio, FAQ LLM via Anthropic Claude Haiku (spec: Decisions). Use model id `claude-haiku-4-5-20251001` unless overridden by `ANTHROPIC_MODEL` env.
- Client config is `client-config.json` (not `.js`), loaded and validated with defaults for every optional field — a malformed/missing field must degrade that feature only, never crash the server or block chat (spec: Fail-safe behavior table).
- Widget embeds via a single `<script>` tag, renders into a **Shadow DOM** root, no iframe, no build step for the embedding site (spec: Embedding).
- Lead save, owner email, and visitor SMS are three independent actions — a failure in email or SMS must never prevent the lead from being saved or the other two from being attempted (spec: Request flow step 4, Fail-safe table).
- No calendar/booking integration, no admin UI, no auth, no frontend framework (spec: Non-goals).

---

## File Structure

```
company-website-chatbot/
├── package.json
├── .env.example
├── .gitignore
├── client-config.example.json
├── server/
│   ├── index.js
│   ├── db.js
│   ├── config-loader.js
│   ├── routes/
│   │   ├── config.js
│   │   ├── chat.js
│   │   └── lead.js
│   ├── services/
│   │   ├── hours.js
│   │   ├── faq.js
│   │   ├── notify-email.js
│   │   └── notify-sms.js
│   └── jobs/
│       └── monthly-recap.js
├── widget/
│   ├── widget.js
│   └── widget.css
├── test/
│   ├── config-loader.test.js
│   ├── hours.test.js
│   ├── db.test.js
│   ├── faq.test.js
│   ├── config-route.test.js
│   ├── chat-route.test.js
│   ├── faq-phrasing.test.js
│   ├── notify-email.test.js
│   ├── notify-sms.test.js
│   ├── lead-route.test.js
│   ├── monthly-recap.test.js
│   ├── widget-logic.test.js
│   └── config-degradation.test.js
├── NEW_CLIENT_SETUP.md
└── README.md
```

---

### Task 1: Project scaffolding + health check

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `server/index.js`
- Test: `test/health.test.js`

**Interfaces:**
- Produces: `server/index.js` exports `createApp({ config, db, anthropicClient, resendClient, twilioClient })` returning an Express app (no `listen()` call — that happens only when run directly), so every later task and every test can boot the app in-process without a real port bound by the module itself. Also exports nothing else at this stage.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "hvac-chatbot",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node server/index.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "better-sqlite3": "^11.3.0",
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "node-cron": "^3.0.3",
    "resend": "^4.0.0",
    "twilio": "^5.3.0"
  }
}
```

- [ ] **Step 2: Write .gitignore**

```
node_modules/
data/
.env
*.sqlite
*.sqlite-journal
```

- [ ] **Step 3: Write .env.example**

```
# Server
PORT=3000
NODE_ENV=development
CONFIG_PATH=./client-config.json
DATA_DB_PATH=./data/leads.sqlite

# Anthropic (FAQ answering)
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# Resend (owner email notifications)
RESEND_API_KEY=
NOTIFY_FROM_EMAIL=leads@yourdomain.com

# Twilio (visitor SMS confirmation)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors. (`better-sqlite3` compiles a native binding — if this fails on the dev machine, note the error and continue; Railway's build environment supports it.)

- [ ] **Step 5: Write server/index.js (health check + createApp only, no other routes yet)**

```javascript
const express = require('express');

function createApp({ config, db, anthropicClient, resendClient, twilioClient } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.locals.config = config;
  app.locals.db = db;
  app.locals.anthropicClient = anthropicClient;
  app.locals.resendClient = resendClient;
  app.locals.twilioClient = twilioClient;

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  require('dotenv').config();
  const port = process.env.PORT || 3000;
  const app = createApp({});
  app.listen(port, () => {
    console.log(`hvac-chatbot listening on port ${port}`);
  });
}
```

- [ ] **Step 6: Write the failing test**

```javascript
// test/health.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../server/index.js');

test('GET /api/health returns ok', async () => {
  const app = createApp({});
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body, { ok: true });
  } finally {
    server.close();
  }
});
```

- [ ] **Step 7: Run the test**

Run: `npm test`
Expected: PASS (this test should pass immediately since Step 5 already implements the route — confirms scaffolding is wired correctly before moving on).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example server/index.js test/health.test.js
git commit -m "Scaffold project: package.json, env template, Express app skeleton"
```

---

### Task 2: Config loader with fail-safe defaults

**Files:**
- Create: `server/config-loader.js`
- Test: `test/config-loader.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `loadConfig(filePath)` — reads and JSON-parses the file at `filePath`, returns a fully-defaulted config object shaped as:
  ```
  {
    businessName: string,
    hours: { display: string|null, timezone: string, schedule: object|null } | null,
    serviceArea: string|null,
    pricing: string|null,
    services: string[],
    branding: { primaryColor: string, accentColor: string, logoUrl: string|null },
    owner: { notificationEmail: string|null, notificationPhone: string|null }
  }
  ```
  Never throws — on any read/parse/validation problem it logs a warning (`console.warn`) and substitutes the documented default for that field only. This exact shape is what every later task (hours, faq, routes) reads from.

- [ ] **Step 1: Write the failing tests**

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/config-loader.test.js` (or `node --test test/config-loader.test.js`)
Expected: FAIL with "Cannot find module '../server/config-loader.js'"

- [ ] **Step 3: Write server/config-loader.js**

```javascript
const fs = require('node:fs');

const DEFAULT_BRANDING = { primaryColor: '#0b1f3a', accentColor: '#d9603b', logoUrl: null };

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateHours(hours) {
  if (!isPlainObject(hours)) return null;
  const display = typeof hours.display === 'string' ? hours.display : null;
  const timezone = typeof hours.timezone === 'string' ? hours.timezone : 'UTC';
  const schedule = isPlainObject(hours.schedule) ? hours.schedule : null;
  if (!display && !schedule) return null;
  return { display, timezone, schedule };
}

function validateBranding(branding) {
  if (!isPlainObject(branding)) return { ...DEFAULT_BRANDING };
  return {
    primaryColor: typeof branding.primaryColor === 'string' ? branding.primaryColor : DEFAULT_BRANDING.primaryColor,
    accentColor: typeof branding.accentColor === 'string' ? branding.accentColor : DEFAULT_BRANDING.accentColor,
    logoUrl: typeof branding.logoUrl === 'string' ? branding.logoUrl : null
  };
}

function validateOwner(owner) {
  if (!isPlainObject(owner)) return { notificationEmail: null, notificationPhone: null };
  return {
    notificationEmail: typeof owner.notificationEmail === 'string' ? owner.notificationEmail : null,
    notificationPhone: typeof owner.notificationPhone === 'string' ? owner.notificationPhone : null
  };
}

function safeDefaultConfig() {
  return {
    businessName: 'Our Company',
    hours: null,
    serviceArea: null,
    pricing: null,
    services: [],
    branding: { ...DEFAULT_BRANDING },
    owner: { notificationEmail: null, notificationPhone: null }
  };
}

function loadConfig(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`[config-loader] could not read config file at ${filePath}: ${err.message}. Using safe defaults.`);
    return safeDefaultConfig();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[config-loader] config file at ${filePath} is not valid JSON: ${err.message}. Using safe defaults.`);
    return safeDefaultConfig();
  }

  if (!isPlainObject(parsed)) {
    console.warn(`[config-loader] config file at ${filePath} did not contain a JSON object. Using safe defaults.`);
    return safeDefaultConfig();
  }

  if (typeof parsed.businessName !== 'string' || !parsed.businessName.trim()) {
    console.warn('[config-loader] businessName missing or invalid; defaulting to "Our Company".');
  }

  return {
    businessName: typeof parsed.businessName === 'string' && parsed.businessName.trim() ? parsed.businessName : 'Our Company',
    hours: validateHours(parsed.hours),
    serviceArea: typeof parsed.serviceArea === 'string' ? parsed.serviceArea : null,
    pricing: typeof parsed.pricing === 'string' ? parsed.pricing : null,
    services: Array.isArray(parsed.services) ? parsed.services.filter((s) => typeof s === 'string') : [],
    branding: validateBranding(parsed.branding),
    owner: validateOwner(parsed.owner)
  };
}

module.exports = { loadConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/config-loader.test.js`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/config-loader.js test/config-loader.test.js
git commit -m "Add config loader with fail-safe defaults for every optional field"
```

---

### Task 3: SQLite database layer

**Files:**
- Create: `server/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createDb(filePath)` — opens/creates the SQLite file (and its parent directory) at `filePath`, applies schema (`CREATE TABLE IF NOT EXISTS`), and returns an object with these methods, used by every later route/job task:
  - `insertConversation(sessionId) -> conversationId` (idempotent: returns existing id if sessionId already has a row)
  - `insertMessage({ conversationId, role, text, answeredFromConfig }) -> messageId`
  - `insertMissedQuestion({ conversationId, questionText }) -> id`
  - `insertLead({ conversationId, name, phone, reason }) -> leadId`
  - `markLeadNotified({ leadId, emailSent, smsSent })`
  - `getRecapStats({ sinceIso, untilIso }) -> { conversationCount: number, leadCount: number }`
  - `hasRecapBeenSent(yearMonth) -> boolean`
  - `markRecapSent(yearMonth)`
  - `raw` — the underlying better-sqlite3 instance, for tests that want to inspect rows directly.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../server/db.js');

function tmpDbPath() {
  return path.join(os.tmpdir(), `test-${Date.now()}-${Math.random()}.sqlite`);
}

test('creates schema and inserts a conversation idempotently', () => {
  const db = createDb(tmpDbPath());
  const id1 = db.insertConversation('session-1');
  const id2 = db.insertConversation('session-1');
  assert.equal(id1, id2);
  const id3 = db.insertConversation('session-2');
  assert.notEqual(id1, id3);
});

test('inserts messages and missed questions linked to a conversation', () => {
  const db = createDb(tmpDbPath());
  const convId = db.insertConversation('session-1');
  const msgId = db.insertMessage({ conversationId: convId, role: 'user', text: 'hi', answeredFromConfig: null });
  assert.ok(msgId > 0);
  const missedId = db.insertMissedQuestion({ conversationId: convId, questionText: 'do you install pools?' });
  assert.ok(missedId > 0);
  const row = db.raw.prepare('SELECT * FROM missed_questions WHERE id = ?').get(missedId);
  assert.equal(row.question_text, 'do you install pools?');
});

test('inserts a lead and marks notification status', () => {
  const db = createDb(tmpDbPath());
  const convId = db.insertConversation('session-1');
  const leadId = db.insertLead({ conversationId: convId, name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' });
  assert.ok(leadId > 0);
  db.markLeadNotified({ leadId, emailSent: true, smsSent: false });
  const row = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  assert.equal(row.email_sent, 1);
  assert.equal(row.sms_sent, 0);
});

test('getRecapStats counts conversations and leads in a date range', () => {
  const db = createDb(tmpDbPath());
  const conv1 = db.insertConversation('s1');
  db.insertConversation('s2');
  db.insertLead({ conversationId: conv1, name: 'A', phone: '1', reason: 'r' });
  const stats = db.getRecapStats({ sinceIso: '2000-01-01T00:00:00.000Z', untilIso: '2999-01-01T00:00:00.000Z' });
  assert.equal(stats.conversationCount, 2);
  assert.equal(stats.leadCount, 1);
});

test('recap-sent tracking prevents duplicate sends for the same month', () => {
  const db = createDb(tmpDbPath());
  assert.equal(db.hasRecapBeenSent('2026-07'), false);
  db.markRecapSent('2026-07');
  assert.equal(db.hasRecapBeenSent('2026-07'), true);
});

test('creates parent directory for the db file if missing', () => {
  const dir = path.join(os.tmpdir(), `test-dir-${Date.now()}`);
  const dbPath = path.join(dir, 'nested', 'leads.sqlite');
  assert.doesNotThrow(() => createDb(dbPath));
  assert.ok(fs.existsSync(dbPath));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/db.test.js`
Expected: FAIL with "Cannot find module '../server/db.js'"

- [ ] **Step 3: Write server/db.js**

```javascript
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  answered_from_config INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  email_sent INTEGER NOT NULL DEFAULT 0,
  sms_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS missed_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id),
  question_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recap_log (
  year_month TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function createDb(filePath) {
  const dir = path.dirname(filePath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const raw = new Database(filePath);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);

  function insertConversation(sessionId) {
    const existing = raw.prepare('SELECT id FROM conversations WHERE session_id = ?').get(sessionId);
    if (existing) return existing.id;
    const info = raw.prepare('INSERT INTO conversations (session_id) VALUES (?)').run(sessionId);
    return info.lastInsertRowid;
  }

  function insertMessage({ conversationId, role, text, answeredFromConfig }) {
    const info = raw
      .prepare('INSERT INTO messages (conversation_id, role, text, answered_from_config) VALUES (?, ?, ?, ?)')
      .run(conversationId, role, text, answeredFromConfig === null || answeredFromConfig === undefined ? null : (answeredFromConfig ? 1 : 0));
    return info.lastInsertRowid;
  }

  function insertMissedQuestion({ conversationId, questionText }) {
    const info = raw
      .prepare('INSERT INTO missed_questions (conversation_id, question_text) VALUES (?, ?)')
      .run(conversationId, questionText);
    return info.lastInsertRowid;
  }

  function insertLead({ conversationId, name, phone, reason }) {
    const info = raw
      .prepare('INSERT INTO leads (conversation_id, name, phone, reason) VALUES (?, ?, ?, ?)')
      .run(conversationId ?? null, name, phone, reason ?? null);
    return info.lastInsertRowid;
  }

  function markLeadNotified({ leadId, emailSent, smsSent }) {
    raw
      .prepare('UPDATE leads SET email_sent = ?, sms_sent = ? WHERE id = ?')
      .run(emailSent ? 1 : 0, smsSent ? 1 : 0, leadId);
  }

  function getRecapStats({ sinceIso, untilIso }) {
    const conv = raw
      .prepare('SELECT COUNT(*) AS c FROM conversations WHERE started_at >= ? AND started_at < ?')
      .get(sinceIso, untilIso);
    const leads = raw
      .prepare('SELECT COUNT(*) AS c FROM leads WHERE created_at >= ? AND created_at < ?')
      .get(sinceIso, untilIso);
    return { conversationCount: conv.c, leadCount: leads.c };
  }

  function hasRecapBeenSent(yearMonth) {
    return !!raw.prepare('SELECT 1 FROM recap_log WHERE year_month = ?').get(yearMonth);
  }

  function markRecapSent(yearMonth) {
    raw.prepare('INSERT OR IGNORE INTO recap_log (year_month) VALUES (?)').run(yearMonth);
  }

  return {
    raw,
    insertConversation,
    insertMessage,
    insertMissedQuestion,
    insertLead,
    markLeadNotified,
    getRecapStats,
    hasRecapBeenSent,
    markRecapSent
  };
}

module.exports = { createDb };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/db.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/db.js test/db.test.js
git commit -m "Add SQLite db layer with schema and repository helpers"
```

---

### Task 4: Hours / after-hours service

**Files:**
- Create: `server/services/hours.js`
- Test: `test/hours.test.js`

**Interfaces:**
- Consumes: a config's `hours` field shape from Task 2 (`{ display, timezone, schedule } | null`).
- Produces: `isOpenNow(hoursConfig, now = new Date()) -> boolean`. Never throws. Used by Task 5 (config route) and the widget's greeting.

- [ ] **Step 1: Write the failing tests**

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/hours.test.js`
Expected: FAIL with "Cannot find module '../server/services/hours.js'"

- [ ] **Step 3: Write server/services/hours.js**

```javascript
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isOpenNow(hoursConfig, now = new Date()) {
  if (!hoursConfig || !hoursConfig.schedule) {
    return true; // fail-safe: no usable schedule means "act like it's open"
  }

  try {
    const timezone = hoursConfig.timezone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);

    const weekday = parts.find((p) => p.type === 'weekday').value.toLowerCase();
    let hour = parts.find((p) => p.type === 'hour').value;
    const minute = parts.find((p) => p.type === 'minute').value;
    if (hour === '24') hour = '00';
    const currentTime = `${hour}:${minute}`;

    if (!DAY_NAMES.includes(weekday)) return true; // shouldn't happen, fail-safe anyway

    const todaySchedule = hoursConfig.schedule[weekday];
    if (!todaySchedule || !todaySchedule.open || !todaySchedule.close) {
      return false; // day is explicitly absent/closed, not a config error
    }

    return currentTime >= todaySchedule.open && currentTime < todaySchedule.close;
  } catch (err) {
    console.warn(`[hours] failed to evaluate open/closed state: ${err.message}. Defaulting to open.`);
    return true; // fail-safe on any unexpected error (e.g. bad timezone string)
  }
}

module.exports = { isOpenNow };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/hours.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/hours.js test/hours.test.js
git commit -m "Add after-hours service with fail-open behavior on bad config"
```

---

### Task 5: GET /api/config route

**Files:**
- Create: `server/routes/config.js`
- Modify: `server/index.js` (mount the router, accept config in `createApp`)
- Test: `test/config-route.test.js`

**Interfaces:**
- Consumes: `isOpenNow` from Task 4; config shape from Task 2.
- Produces: `createConfigRouter(config)` returning an Express router mounted at `/api`. `GET /api/config` returns the public-safe subset:
  ```
  { businessName, branding, hours: { display }, isOpenNow: boolean, services, serviceArea, pricing }
  ```
  (never includes `owner` — that stays server-side only).

- [ ] **Step 1: Write the failing test**

```javascript
// test/config-route.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/config-route.test.js`
Expected: FAIL — 404 (route not mounted) / assertion errors

- [ ] **Step 3: Write server/routes/config.js**

```javascript
const express = require('express');
const { isOpenNow } = require('../services/hours.js');

function createConfigRouter(config) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json({
      businessName: config.businessName,
      branding: config.branding,
      hours: { display: config.hours ? config.hours.display : null },
      isOpenNow: isOpenNow(config.hours),
      services: config.services,
      serviceArea: config.serviceArea,
      pricing: config.pricing
    });
  });

  return router;
}

module.exports = { createConfigRouter };
```

- [ ] **Step 4: Modify server/index.js to mount it**

```javascript
const express = require('express');
const { createConfigRouter } = require('./routes/config.js');

function createApp({ config, db, anthropicClient, resendClient, twilioClient } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  if (config) {
    app.use('/api', createConfigRouter(config));
  }

  app.locals.config = config;
  app.locals.db = db;
  app.locals.anthropicClient = anthropicClient;
  app.locals.resendClient = resendClient;
  app.locals.twilioClient = twilioClient;

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  require('dotenv').config();
  const path = require('node:path');
  const { loadConfig } = require('./config-loader.js');
  const { createDb } = require('./db.js');

  const config = loadConfig(process.env.CONFIG_PATH || path.join(__dirname, '..', 'client-config.json'));
  const db = createDb(process.env.DATA_DB_PATH || path.join(__dirname, '..', 'data', 'leads.sqlite'));

  const port = process.env.PORT || 3000;
  const app = createApp({ config, db });
  app.listen(port, () => {
    console.log(`hvac-chatbot listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/config-route.test.js test/health.test.js`
Expected: PASS (both files)

- [ ] **Step 6: Commit**

```bash
git add server/routes/config.js server/index.js test/config-route.test.js
git commit -m "Add GET /api/config route with after-hours awareness"
```

---

### Task 6: FAQ service (Claude Haiku, grounded)

**Files:**
- Create: `server/services/faq.js`
- Test: `test/faq.test.js`

**Interfaces:**
- Consumes: config shape from Task 2.
- Produces: `async answerQuestion({ config, message, anthropicClient, model }) -> { inScope: boolean, answer: string }`. Never throws — on any Anthropic API error or unparseable response, returns a safe fallback. `anthropicClient` is injected (an object with a `messages.create(...)` method) so tests never hit the network.

- [ ] **Step 1: Write the failing tests**

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/faq.test.js`
Expected: FAIL with "Cannot find module '../server/services/faq.js'"

- [ ] **Step 3: Write server/services/faq.js**

```javascript
function buildSystemPrompt(config) {
  const lines = [
    `You are a helpful assistant for ${config.businessName}, an HVAC company.`,
    'Answer the visitor question using ONLY the business information below.',
    'Never invent or guess pricing, hours, availability, or services that are not listed here.',
    'If the question cannot be answered from this information, set "inScope" to false.',
    '',
    'Business information:',
    `- Hours: ${config.hours && config.hours.display ? config.hours.display : 'not provided'}`,
    `- Service area: ${config.serviceArea || 'not provided'}`,
    `- Pricing: ${config.pricing || 'not provided'}`,
    `- Services offered: ${config.services && config.services.length ? config.services.join(', ') : 'not provided'}`,
    '',
    'Respond with ONLY a JSON object, no other text, in this exact shape:',
    '{"inScope": true|false, "answer": "your answer as a short, friendly sentence or two"}',
    'If inScope is false, "answer" can be an empty string.'
  ];
  return lines.join('\n');
}

function safeFallback() {
  return {
    inScope: false,
    answer: "I'm not able to answer that from what I know about this business — let me get your contact info so someone can follow up."
  };
}

async function answerQuestion({ config, message, anthropicClient, model }) {
  const system = buildSystemPrompt(config);
  let response;
  try {
    response = await anthropicClient.messages.create({
      model,
      max_tokens: 300,
      system,
      messages: [{ role: 'user', content: message }]
    });
  } catch (err) {
    console.warn(`[faq] Anthropic API call failed: ${err.message}`);
    return safeFallback();
  }

  try {
    const textBlock = response.content.find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock.text);
    if (typeof parsed.inScope !== 'boolean' || typeof parsed.answer !== 'string') {
      throw new Error('unexpected response shape');
    }
    return { inScope: parsed.inScope, answer: parsed.answer };
  } catch (err) {
    console.warn(`[faq] could not parse model response: ${err.message}`);
    return safeFallback();
  }
}

module.exports = { answerQuestion, buildSystemPrompt };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/faq.test.js`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/faq.js test/faq.test.js
git commit -m "Add FAQ service: grounded system prompt + Claude Haiku call with fail-safe fallback"
```

---

### Task 7: POST /api/chat route

**Files:**
- Create: `server/routes/chat.js`
- Modify: `server/index.js` (mount router, wire `anthropicClient`/`model`/`db`)
- Test: `test/chat-route.test.js`

**Interfaces:**
- Consumes: `answerQuestion` from Task 6, db methods from Task 3.
- Produces: `createChatRouter({ config, db, anthropicClient, model })` router. `POST /api/chat` body `{ sessionId, message }` → `{ answer, inScope }`. Persists the user message, the assistant message (with `answeredFromConfig`), and — when `inScope` is false — a `missed_questions` row.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/chat-route.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/chat-route.test.js`
Expected: FAIL — 404s (route not mounted)

- [ ] **Step 3: Write server/routes/chat.js**

```javascript
const express = require('express');
const { answerQuestion } = require('../services/faq.js');

function createChatRouter({ config, db, anthropicClient, model }) {
  const router = express.Router();

  router.post('/chat', async (req, res) => {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message || typeof message !== 'string') {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    const conversationId = db.insertConversation(sessionId);
    db.insertMessage({ conversationId, role: 'user', text: message, answeredFromConfig: null });

    const { inScope, answer } = await answerQuestion({ config, message, anthropicClient, model });

    db.insertMessage({ conversationId, role: 'assistant', text: answer, answeredFromConfig: inScope });
    if (!inScope) {
      db.insertMissedQuestion({ conversationId, questionText: message });
    }

    res.json({ answer, inScope });
  });

  return router;
}

module.exports = { createChatRouter };
```

- [ ] **Step 4: Modify server/index.js**

```javascript
const express = require('express');
const { createConfigRouter } = require('./routes/config.js');
const { createChatRouter } = require('./routes/chat.js');

function createApp({ config, db, anthropicClient, resendClient, twilioClient, model } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  if (config) {
    app.use('/api', createConfigRouter(config));
  }
  if (config && db) {
    app.use('/api', createChatRouter({ config, db, anthropicClient, model }));
  }

  app.locals.config = config;
  app.locals.db = db;
  app.locals.anthropicClient = anthropicClient;
  app.locals.resendClient = resendClient;
  app.locals.twilioClient = twilioClient;

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  require('dotenv').config();
  const path = require('node:path');
  const { Anthropic } = require('@anthropic-ai/sdk');
  const { loadConfig } = require('./config-loader.js');
  const { createDb } = require('./db.js');

  const config = loadConfig(process.env.CONFIG_PATH || path.join(__dirname, '..', 'client-config.json'));
  const db = createDb(process.env.DATA_DB_PATH || path.join(__dirname, '..', 'data', 'leads.sqlite'));
  const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const port = process.env.PORT || 3000;
  const app = createApp({ config, db, anthropicClient, model });
  app.listen(port, () => {
    console.log(`hvac-chatbot listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/chat-route.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Run the full test suite so far**

Run: `npm test`
Expected: PASS (all tests across all files so far)

- [ ] **Step 7: Commit**

```bash
git add server/routes/chat.js server/index.js test/chat-route.test.js
git commit -m "Add POST /api/chat route with conversation + missed-question logging"
```

---

### Task 8: FAQ phrasing correctness suite (reliability requirement)

**Files:**
- Create: `test/faq-phrasing.test.js`
- Create: `client-config.example.json` (needed now so this test has real content to ground against; also the Task 15 deliverable — later tasks only add to it if needed)

**Interfaces:**
- Consumes: `answerQuestion` from Task 6.
- Produces: nothing new consumed by later tasks — this is a reliability gate required by the spec's Testing plan, item 1.

This test calls the **real** Anthropic API against `client-config.example.json` if `ANTHROPIC_API_KEY` is set in the environment, and is explicitly skipped (not failed) otherwise — the point is to give a true reliability signal when a key is available, without breaking `npm test` for contributors who don't have one configured.

- [ ] **Step 1: Write client-config.example.json**

```json
{
  "businessName": "Lone Star Comfort Heating & Air",
  "hours": {
    "display": "Mon-Fri 8:00am-6:00pm, Sat 9:00am-2:00pm, closed Sunday",
    "timezone": "America/Chicago",
    "schedule": {
      "monday": { "open": "08:00", "close": "18:00" },
      "tuesday": { "open": "08:00", "close": "18:00" },
      "wednesday": { "open": "08:00", "close": "18:00" },
      "thursday": { "open": "08:00", "close": "18:00" },
      "friday": { "open": "08:00", "close": "18:00" },
      "saturday": { "open": "09:00", "close": "14:00" },
      "sunday": null
    }
  },
  "serviceArea": "We serve the greater Austin, Texas metro area, including Round Rock, Cedar Park, and Pflugerville, within about a 25-mile radius of downtown Austin.",
  "pricing": "Diagnostic visits are a flat $99, which is credited toward any repair we perform. Most common repairs range from $150-$600. Full system replacements are quoted after an on-site inspection.",
  "services": [
    "AC repair and maintenance",
    "Furnace repair and installation",
    "Duct cleaning and sealing",
    "Thermostat installation",
    "Full HVAC system replacement",
    "Indoor air quality assessments"
  ],
  "branding": {
    "primaryColor": "#0b1f3a",
    "accentColor": "#d9603b",
    "logoUrl": null
  },
  "owner": {
    "notificationEmail": "owner@example.com",
    "notificationPhone": "+15125550100"
  }
}
```

- [ ] **Step 2: Write test/faq-phrasing.test.js**

```javascript
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
```

- [ ] **Step 3: Run without an API key to confirm graceful skip**

Run: `node --test test/faq-phrasing.test.js`
Expected: the "exists and loads" test PASSes; the 9 phrasing tests report SKIP (not fail) with the reason string, so CI without a key never breaks.

- [ ] **Step 4: Run with a real key to get the reliability signal required by the spec**

Run (with a real key exported): `ANTHROPIC_API_KEY=sk-ant-... node --test test/faq-phrasing.test.js`
Expected: all 10 tests PASS. If any phrasing fails, adjust `buildSystemPrompt` in `server/services/faq.js` (Task 6) — e.g. make the instruction to draw on all listed fields more explicit — and re-run until all 9 phrasings pass. Do not weaken the assertions to force a pass.

- [ ] **Step 5: Commit**

```bash
git add client-config.example.json test/faq-phrasing.test.js
git commit -m "Add example client config and live FAQ phrasing reliability suite"
```

---

### Task 9: Email notification service (Resend)

**Files:**
- Create: `server/services/notify-email.js`
- Test: `test/notify-email.test.js`

**Interfaces:**
- Consumes: config `owner.notificationEmail`, `businessName`.
- Produces: `async sendLeadEmail({ resendClient, config, lead, fromEmail }) -> { ok: boolean, error?: string }`. Never throws.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/notify-email.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendLeadEmail } = require('../server/services/notify-email.js');

const config = { businessName: 'Acme HVAC', owner: { notificationEmail: 'owner@acme.com', notificationPhone: null } };
const lead = { name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' };

test('sends email successfully', async () => {
  let captured = null;
  const resendClient = { emails: { send: async (args) => { captured = args; return { data: { id: 'abc' } }; } } };
  const result = await sendLeadEmail({ resendClient, config, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, true);
  assert.equal(captured.to, 'owner@acme.com');
  assert.match(captured.subject, /Acme HVAC/);
  assert.match(captured.text, /Jane/);
});

test('missing owner email returns ok:false without throwing', async () => {
  const cfgNoEmail = { businessName: 'Acme HVAC', owner: { notificationEmail: null, notificationPhone: null } };
  const resendClient = { emails: { send: async () => ({ data: { id: 'abc' } }) } };
  const result = await sendLeadEmail({ resendClient, config: cfgNoEmail, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, false);
  assert.match(result.error, /no owner email/i);
});

test('Resend API failure returns ok:false without throwing', async () => {
  const resendClient = { emails: { send: async () => { throw new Error('resend down'); } } };
  const result = await sendLeadEmail({ resendClient, config, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, false);
  assert.match(result.error, /resend down/);
});

test('missing resendClient (e.g. no API key configured) returns ok:false without throwing', async () => {
  const result = await sendLeadEmail({ resendClient: null, config, lead, fromEmail: 'leads@x.com' });
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/notify-email.test.js`
Expected: FAIL with "Cannot find module '../server/services/notify-email.js'"

- [ ] **Step 3: Write server/services/notify-email.js**

```javascript
async function sendLeadEmail({ resendClient, config, lead, fromEmail }) {
  if (!config.owner || !config.owner.notificationEmail) {
    console.warn('[notify-email] no owner notification email configured; skipping.');
    return { ok: false, error: 'no owner email configured' };
  }
  if (!resendClient) {
    console.warn('[notify-email] no Resend client configured; skipping.');
    return { ok: false, error: 'no email client configured' };
  }

  try {
    await resendClient.emails.send({
      from: fromEmail,
      to: config.owner.notificationEmail,
      subject: `New lead for ${config.businessName}: ${lead.name}`,
      text: `New lead from the website chatbot.\n\nName: ${lead.name}\nPhone: ${lead.phone}\nReason: ${lead.reason || '(not provided)'}\n`
    });
    return { ok: true };
  } catch (err) {
    console.warn(`[notify-email] send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendLeadEmail };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/notify-email.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/notify-email.js test/notify-email.test.js
git commit -m "Add Resend email notification service with isolated failure handling"
```

---

### Task 10: SMS notification service (Twilio)

**Files:**
- Create: `server/services/notify-sms.js`
- Test: `test/notify-sms.test.js`

**Interfaces:**
- Consumes: `businessName` from config, `lead.phone`, `lead.name`.
- Produces: `async sendLeadSms({ twilioClient, config, lead, fromNumber }) -> { ok: boolean, error?: string }`. Never throws.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/notify-sms.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sendLeadSms } = require('../server/services/notify-sms.js');

const config = { businessName: 'Acme HVAC' };
const lead = { name: 'Jane', phone: '+15125550100', reason: 'AC not cooling' };

test('sends sms successfully', async () => {
  let captured = null;
  const twilioClient = { messages: { create: async (args) => { captured = args; return { sid: 'SM123' }; } } };
  const result = await sendLeadSms({ twilioClient, config, lead, fromNumber: '+15125550199' });
  assert.equal(result.ok, true);
  assert.equal(captured.to, '+15125550100');
  assert.match(captured.body, /Jane/);
  assert.match(captured.body, /Acme HVAC/);
});

test('Twilio API failure returns ok:false without throwing (simulated SMS failure)', async () => {
  const twilioClient = { messages: { create: async () => { throw new Error('simulated Twilio outage'); } } };
  const result = await sendLeadSms({ twilioClient, config, lead, fromNumber: '+15125550199' });
  assert.equal(result.ok, false);
  assert.match(result.error, /simulated Twilio outage/);
});

test('missing twilioClient returns ok:false without throwing', async () => {
  const result = await sendLeadSms({ twilioClient: null, config, lead, fromNumber: '+15125550199' });
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/notify-sms.test.js`
Expected: FAIL with "Cannot find module '../server/services/notify-sms.js'"

- [ ] **Step 3: Write server/services/notify-sms.js**

```javascript
async function sendLeadSms({ twilioClient, config, lead, fromNumber }) {
  if (!twilioClient) {
    console.warn('[notify-sms] no Twilio client configured; skipping.');
    return { ok: false, error: 'no sms client configured' };
  }

  try {
    await twilioClient.messages.create({
      to: lead.phone,
      from: fromNumber,
      body: `Thanks ${lead.name}, got your request for ${config.businessName}. Someone will call you shortly.`
    });
    return { ok: true };
  } catch (err) {
    console.warn(`[notify-sms] send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendLeadSms };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/notify-sms.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/services/notify-sms.js test/notify-sms.test.js
git commit -m "Add Twilio SMS notification service with isolated failure handling"
```

---

### Task 11: POST /api/lead route (orchestration + independent failure isolation)

**Files:**
- Create: `server/routes/lead.js`
- Modify: `server/index.js` (mount router, wire `resendClient`/`twilioClient`/`fromEmail`/`fromNumber`)
- Test: `test/lead-route.test.js`

**Interfaces:**
- Consumes: `sendLeadEmail` (Task 9), `sendLeadSms` (Task 10), db methods (Task 3).
- Produces: `createLeadRouter({ config, db, resendClient, twilioClient, fromEmail, fromNumber })` router. `POST /api/lead` body `{ sessionId, name, phone, reason }` → `{ ok: true, leadId }` on success. This is the task that proves the spec's core reliability requirement: SMS failure never loses or un-acknowledges a lead.

- [ ] **Step 1: Write the failing tests**

```javascript
// test/lead-route.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/lead-route.test.js`
Expected: FAIL — 404s (route not mounted)

- [ ] **Step 3: Write server/routes/lead.js**

```javascript
const express = require('express');
const { sendLeadEmail } = require('../services/notify-email.js');
const { sendLeadSms } = require('../services/notify-sms.js');

function createLeadRouter({ config, db, resendClient, twilioClient, fromEmail, fromNumber }) {
  const router = express.Router();

  router.post('/lead', async (req, res) => {
    const { sessionId, name, phone, reason } = req.body || {};
    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }

    const conversationId = sessionId ? db.insertConversation(sessionId) : null;

    let leadId;
    try {
      leadId = db.insertLead({ conversationId, name, phone, reason });
    } catch (err) {
      // The one hard failure per spec: we cannot silently drop a lead.
      console.error(`[lead] FAILED TO SAVE LEAD: ${err.message}`, { name, phone, reason });
      return res.status(500).json({
        error: 'We could not save your request right now. Please call us directly.'
      });
    }

    const lead = { name, phone, reason };

    const [emailResult, smsResult] = await Promise.allSettled([
      sendLeadEmail({ resendClient, config, lead, fromEmail }),
      sendLeadSms({ twilioClient, config, lead, fromNumber })
    ]);

    const emailOk = emailResult.status === 'fulfilled' && emailResult.value.ok;
    const smsOk = smsResult.status === 'fulfilled' && smsResult.value.ok;

    db.markLeadNotified({ leadId, emailSent: emailOk, smsSent: smsOk });

    res.json({ ok: true, leadId });
  });

  return router;
}

module.exports = { createLeadRouter };
```

- [ ] **Step 4: Modify server/index.js**

```javascript
const express = require('express');
const { createConfigRouter } = require('./routes/config.js');
const { createChatRouter } = require('./routes/chat.js');
const { createLeadRouter } = require('./routes/lead.js');

function createApp({
  config,
  db,
  anthropicClient,
  resendClient,
  twilioClient,
  model,
  fromEmail,
  fromNumber
} = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  if (config) {
    app.use('/api', createConfigRouter(config));
  }
  if (config && db) {
    app.use('/api', createChatRouter({ config, db, anthropicClient, model }));
    app.use('/api', createLeadRouter({ config, db, resendClient, twilioClient, fromEmail, fromNumber }));
  }

  app.locals.config = config;
  app.locals.db = db;

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  require('dotenv').config();
  const path = require('node:path');
  const { Anthropic } = require('@anthropic-ai/sdk');
  const { Resend } = require('resend');
  const twilio = require('twilio');
  const { loadConfig } = require('./config-loader.js');
  const { createDb } = require('./db.js');

  const config = loadConfig(process.env.CONFIG_PATH || path.join(__dirname, '..', 'client-config.json'));
  const db = createDb(process.env.DATA_DB_PATH || path.join(__dirname, '..', 'data', 'leads.sqlite'));
  const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const twilioClient =
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      : null;

  const port = process.env.PORT || 3000;
  const app = createApp({
    config,
    db,
    anthropicClient,
    model,
    resendClient,
    twilioClient,
    fromEmail: process.env.NOTIFY_FROM_EMAIL,
    fromNumber: process.env.TWILIO_FROM_NUMBER
  });
  app.listen(port, () => {
    console.log(`hvac-chatbot listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/lead-route.test.js`
Expected: PASS (all 4 tests) — this confirms the spec's required reliability scenario: a simulated SMS failure still results in a saved, emailed lead and a success response to the visitor.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS across all files (live-model phrasing tests SKIP unless a key is exported, per Task 8)

- [ ] **Step 7: Commit**

```bash
git add server/routes/lead.js server/index.js test/lead-route.test.js
git commit -m "Add POST /api/lead route: independent save/email/sms with failure isolation"
```

---

### Task 12: Monthly recap job

**Files:**
- Create: `server/jobs/monthly-recap.js`
- Modify: `server/index.js` (schedule the job when run directly, not in tests)
- Test: `test/monthly-recap.test.js`

**Interfaces:**
- Consumes: `db.getRecapStats`, `db.hasRecapBeenSent`, `db.markRecapSent` (Task 3); `sendLeadEmail`-style pattern but a distinct email — implemented locally in this file since content differs (no `lead` object).
- Produces: `async runMonthlyRecapIfDue({ db, config, resendClient, fromEmail, now }) -> { sent: boolean, reason?: string }`; `scheduleMonthlyRecap({ db, config, resendClient, fromEmail })` (wires a daily `node-cron` tick — not unit tested, only wired in `index.js`).

- [ ] **Step 1: Write the failing tests**

```javascript
// test/monthly-recap.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../server/db.js');
const { runMonthlyRecapIfDue } = require('../server/jobs/monthly-recap.js');

const config = { businessName: 'Acme HVAC', owner: { notificationEmail: 'owner@acme.com', notificationPhone: null } };

function freshDb() {
  return createDb(path.join(os.tmpdir(), `recap-test-${Date.now()}-${Math.random()}.sqlite`));
}

test('sends a recap covering the previous full month, with real counts', async () => {
  const db = freshDb();
  // Insert data timestamped in July 2026 by manipulating started_at/created_at directly.
  const convId = db.insertConversation('s1');
  db.raw.prepare("UPDATE conversations SET started_at = '2026-07-15T10:00:00.000Z' WHERE id = ?").run(convId);
  const leadId = db.insertLead({ conversationId: convId, name: 'Jane', phone: '1', reason: 'r' });
  db.raw.prepare("UPDATE leads SET created_at = '2026-07-15T10:00:00.000Z' WHERE id = ?").run(leadId);

  let captured = null;
  const resendClient = { emails: { send: async (args) => { captured = args; return { data: { id: 'e1' } }; } } };

  const result = await runMonthlyRecapIfDue({
    db,
    config,
    resendClient,
    fromEmail: 'leads@x.com',
    now: new Date('2026-08-01T06:00:00.000Z')
  });

  assert.equal(result.sent, true);
  assert.match(captured.text, /1 conversation/i);
  assert.match(captured.text, /1 lead/i);
});

test('does not send twice for the same month', async () => {
  const db = freshDb();
  const resendClient = { emails: { send: async () => ({ data: { id: 'e1' } }) } };
  const now = new Date('2026-08-01T06:00:00.000Z');

  const first = await runMonthlyRecapIfDue({ db, config, resendClient, fromEmail: 'leads@x.com', now });
  const second = await runMonthlyRecapIfDue({ db, config, resendClient, fromEmail: 'leads@x.com', now });

  assert.equal(first.sent, true);
  assert.equal(second.sent, false);
  assert.match(second.reason, /already sent/i);
});

test('missing owner email does not throw, reports not sent', async () => {
  const db = freshDb();
  const cfgNoEmail = { businessName: 'Acme HVAC', owner: { notificationEmail: null, notificationPhone: null } };
  const resendClient = { emails: { send: async () => ({ data: { id: 'e1' } }) } };
  const result = await runMonthlyRecapIfDue({
    db,
    config: cfgNoEmail,
    resendClient,
    fromEmail: 'leads@x.com',
    now: new Date('2026-08-01T06:00:00.000Z')
  });
  assert.equal(result.sent, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/monthly-recap.test.js`
Expected: FAIL with "Cannot find module '../server/jobs/monthly-recap.js'"

- [ ] **Step 3: Write server/jobs/monthly-recap.js**

```javascript
const cron = require('node-cron');

function previousMonthRange(now) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; "this month" start
  const prevMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const thisMonthStart = new Date(Date.UTC(year, month, 1));
  const yearMonth = `${prevMonthStart.getUTCFullYear()}-${String(prevMonthStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return { sinceIso: prevMonthStart.toISOString(), untilIso: thisMonthStart.toISOString(), yearMonth };
}

async function runMonthlyRecapIfDue({ db, config, resendClient, fromEmail, now = new Date() }) {
  const { sinceIso, untilIso, yearMonth } = previousMonthRange(now);

  if (db.hasRecapBeenSent(yearMonth)) {
    return { sent: false, reason: 'already sent for this month' };
  }

  if (!config.owner || !config.owner.notificationEmail || !resendClient) {
    console.warn('[monthly-recap] no owner email or email client configured; skipping recap send.');
    return { sent: false, reason: 'no owner email or email client configured' };
  }

  const stats = db.getRecapStats({ sinceIso, untilIso });

  try {
    await resendClient.emails.send({
      from: fromEmail,
      to: config.owner.notificationEmail,
      subject: `${config.businessName} chatbot recap for ${yearMonth}`,
      text: `Here's your monthly chatbot recap for ${yearMonth}:\n\n${stats.conversationCount} conversation${stats.conversationCount === 1 ? '' : 's'} handled\n${stats.leadCount} lead${stats.leadCount === 1 ? '' : 's'} captured\n`
    });
    db.markRecapSent(yearMonth);
    return { sent: true };
  } catch (err) {
    console.warn(`[monthly-recap] send failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

function scheduleMonthlyRecap({ db, config, resendClient, fromEmail }) {
  // Runs daily at 06:00 server time; the "already sent this month" check inside
  // runMonthlyRecapIfDue makes this safe to check every day without duplicate sends.
  cron.schedule('0 6 * * *', () => {
    runMonthlyRecapIfDue({ db, config, resendClient, fromEmail }).catch((err) => {
      console.error(`[monthly-recap] unexpected error: ${err.message}`);
    });
  });
}

module.exports = { runMonthlyRecapIfDue, scheduleMonthlyRecap, previousMonthRange };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/monthly-recap.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Wire scheduling into server/index.js (only when run directly)**

Add near the bottom of the `if (require.main === module)` block, after `app.listen(...)`:

```javascript
  const { scheduleMonthlyRecap } = require('./jobs/monthly-recap.js');
  if (resendClient) {
    scheduleMonthlyRecap({ db, config, resendClient, fromEmail: process.env.NOTIFY_FROM_EMAIL });
  }
```

- [ ] **Step 6: Commit**

```bash
git add server/jobs/monthly-recap.js server/index.js test/monthly-recap.test.js
git commit -m "Add monthly recap job with duplicate-send prevention"
```

---

### Task 13: Widget shell — Shadow DOM embed, branding, after-hours greeting

**Files:**
- Create: `widget/widget.js`
- Create: `widget/widget.css`
- Modify: `server/index.js` (serve `widget/` as static files)
- Test: `test/widget-logic.test.js`

**Interfaces:**
- Consumes: `GET /api/config` response shape from Task 5.
- Produces (in `widget.js`, dual CommonJS/browser export): `formatGreeting(config) -> string` and `buildQuickReplyAnswer(config, key) -> string` (`key` is one of `'hours' | 'serviceArea' | 'pricing'`). These are pure functions, extracted so their logic is unit-testable without a DOM; the rest of `widget.js` is DOM/fetch wiring that Task 14 completes, verified by `node --check` (syntax) plus manual embed testing (documented in README).

- [ ] **Step 1: Write the failing tests**

```javascript
// test/widget-logic.test.js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/widget-logic.test.js`
Expected: FAIL with "Cannot find module '../widget/widget.js'"

- [ ] **Step 3: Write widget/widget.js (pure logic + Shadow DOM shell)**

```javascript
(function () {
  'use strict';

  function formatGreeting(config) {
    const name = config.businessName || 'us';
    if (config.isOpenNow === false) {
      return `We're closed right now, but I can still help — ask me a question or leave your info and we'll get back to you.`;
    }
    return `Hi! I'm the virtual assistant for ${name}. Ask me about hours, service area, pricing, or anything else.`;
  }

  function buildQuickReplyAnswer(config, key) {
    if (key === 'hours') {
      const display = config.hours && config.hours.display;
      return display ? `Our hours: ${display}` : `We don't have set hours listed here — please contact us and we'll let you know.`;
    }
    if (key === 'serviceArea') {
      return config.serviceArea
        ? `Here's our service area: ${config.serviceArea}`
        : `Please leave your info and we'll confirm whether we cover your area.`;
    }
    if (key === 'pricing') {
      return config.pricing
        ? `Here's how our pricing works: ${config.pricing}`
        : `Pricing depends on the job — leave your info and we'll follow up with details.`;
    }
    return `Let me get your info so we can help with that.`;
  }

  // --- Browser-only DOM wiring below; skipped entirely under Node (no `document`). ---
  if (typeof document !== 'undefined') {
    (function init() {
      const scriptTag = document.currentScript;
      const apiBase = new URL(scriptTag.src).origin;

      const host = document.createElement('div');
      host.id = 'hvac-chatbot-widget-host';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });

      const styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.href = `${apiBase}/widget.css`;
      shadow.appendChild(styleLink);

      const bubble = document.createElement('button');
      bubble.className = 'hvac-bubble';
      bubble.setAttribute('aria-label', 'Open chat');
      bubble.textContent = '💬';
      shadow.appendChild(bubble);

      const panel = document.createElement('div');
      panel.className = 'hvac-panel hvac-hidden';
      panel.innerHTML = `
        <div class="hvac-header"><span class="hvac-title"></span><button class="hvac-close" aria-label="Close chat">×</button></div>
        <div class="hvac-messages"></div>
        <div class="hvac-quick-replies">
          <button data-key="hours">Hours</button>
          <button data-key="serviceArea">Service area</button>
          <button data-key="pricing">Pricing</button>
          <button data-key="book">Book a visit</button>
        </div>
        <form class="hvac-input-row">
          <input type="text" placeholder="Type a question..." />
          <button type="submit">Send</button>
        </form>
        <form class="hvac-lead-form hvac-hidden">
          <input type="text" name="name" placeholder="Your name" required />
          <input type="tel" name="phone" placeholder="Phone number" required />
          <textarea name="reason" placeholder="What do you need help with?"></textarea>
          <button type="submit">Send request</button>
        </form>
      `;
      shadow.appendChild(panel);

      let config = null;
      const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      function appendMessage(role, text) {
        const el = document.createElement('div');
        el.className = `hvac-message hvac-message-${role}`;
        el.textContent = text;
        panel.querySelector('.hvac-messages').appendChild(el);
        panel.querySelector('.hvac-messages').scrollTop = panel.querySelector('.hvac-messages').scrollHeight;
      }

      function showLeadForm() {
        panel.querySelector('.hvac-lead-form').classList.remove('hvac-hidden');
      }

      function applyBranding(cfg) {
        host.style.setProperty('--hvac-primary', cfg.branding.primaryColor);
        host.style.setProperty('--hvac-accent', cfg.branding.accentColor);
        panel.querySelector('.hvac-title').textContent = cfg.businessName;
      }

      fetch(`${apiBase}/api/config`)
        .then((r) => r.json())
        .then((cfg) => {
          config = cfg;
          applyBranding(cfg);
          appendMessage('assistant', formatGreeting(cfg));
        })
        .catch(() => {
          appendMessage('assistant', "Hi! I'm having trouble loading right now, but you can still leave your info below.");
          showLeadForm();
        });

      bubble.addEventListener('click', () => {
        panel.classList.toggle('hvac-hidden');
      });
      panel.querySelector('.hvac-close').addEventListener('click', () => {
        panel.classList.add('hvac-hidden');
      });

      panel.querySelector('.hvac-quick-replies').addEventListener('click', (e) => {
        const key = e.target.getAttribute('data-key');
        if (!key || !config) return;
        if (key === 'book') {
          showLeadForm();
          return;
        }
        appendMessage('assistant', buildQuickReplyAnswer(config, key));
      });

      panel.querySelector('.hvac-input-row').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = panel.querySelector('.hvac-input-row input');
        const message = input.value.trim();
        if (!message) return;
        appendMessage('user', message);
        input.value = '';
        try {
          const res = await fetch(`${apiBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, message })
          });
          const body = await res.json();
          appendMessage('assistant', body.answer);
          if (!body.inScope) showLeadForm();
        } catch (err) {
          appendMessage('assistant', "Sorry, I'm having trouble answering right now. Please leave your info below.");
          showLeadForm();
        }
      });

      panel.querySelector('.hvac-lead-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const name = form.name.value.trim();
        const phone = form.phone.value.trim();
        const reason = form.reason.value.trim();
        try {
          const res = await fetch(`${apiBase}/api/lead`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, name, phone, reason })
          });
          if (res.ok) {
            appendMessage('assistant', `Thanks ${name}! We've got your request and will be in touch shortly.`);
            form.classList.add('hvac-hidden');
          } else {
            appendMessage('assistant', 'Something went wrong saving your request — please call us directly.');
          }
        } catch (err) {
          appendMessage('assistant', 'Something went wrong saving your request — please call us directly.');
        }
      });
    })();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatGreeting, buildQuickReplyAnswer };
  }
})();
```

- [ ] **Step 4: Write widget/widget.css**

```css
:host {
  --hvac-primary: #0b1f3a;
  --hvac-accent: #d9603b;
}

.hvac-bubble {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--hvac-primary);
  color: white;
  border: none;
  font-size: 24px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 2147483000;
}

.hvac-panel {
  position: fixed;
  bottom: 92px;
  right: 24px;
  width: 340px;
  max-width: calc(100vw - 32px);
  height: 480px;
  max-height: calc(100vh - 140px);
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: Georgia, 'Times New Roman', serif;
  z-index: 2147483000;
}

.hvac-hidden {
  display: none !important;
}

.hvac-header {
  background: var(--hvac-primary);
  color: white;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
}

.hvac-close {
  background: none;
  border: none;
  color: white;
  font-size: 20px;
  cursor: pointer;
}

.hvac-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
}

.hvac-message {
  margin-bottom: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  max-width: 85%;
}

.hvac-message-assistant {
  background: #f0f0f0;
  color: #111;
}

.hvac-message-user {
  background: var(--hvac-accent);
  color: white;
  margin-left: auto;
}

.hvac-quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
}

.hvac-quick-replies button {
  border: 1px solid var(--hvac-accent);
  color: var(--hvac-accent);
  background: white;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.hvac-input-row,
.hvac-lead-form {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid #eee;
}

.hvac-lead-form {
  flex-direction: column;
}

.hvac-input-row input,
.hvac-lead-form input,
.hvac-lead-form textarea {
  font-family: inherit;
  font-size: 14px;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 8px;
  flex: 1;
}

.hvac-input-row button,
.hvac-lead-form button {
  background: var(--hvac-accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
}
```

- [ ] **Step 5: Modify server/index.js to serve static widget assets**

Add near the top of `createApp`, after `app.use(express.json())`:

```javascript
  const path = require('node:path');
  app.use(express.static(path.join(__dirname, '..', 'widget')));
```

(Add `const path = require('node:path');` once at the top of the file if not already present from Task 5/7 edits — check before adding a duplicate declaration.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/widget-logic.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 7: Verify widget.js is syntactically valid for the browser**

Run: `node --check widget/widget.js`
Expected: no output, exit code 0 (confirms no syntax errors; browser-only globals like `document`/`fetch` are fine since `--check` only parses).

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS across all files

- [ ] **Step 9: Commit**

```bash
git add widget/widget.js widget/widget.css server/index.js test/widget-logic.test.js
git commit -m "Add embeddable widget: Shadow DOM shell, branding, after-hours greeting, quick replies, chat, lead form"
```

---

### Task 14: Config-degradation integration test (full server, all fail-safe scenarios)

**Files:**
- Create: `test/config-degradation.test.js`

**Interfaces:**
- Consumes: `createApp` (Task 11's final signature), `loadConfig` (Task 2). No new interfaces produced — this is the spec's required reliability gate for "config file missing/malformed a field → widget/server degrades gracefully."

- [ ] **Step 1: Write test/config-degradation.test.js**

```javascript
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
```

- [ ] **Step 2: Run the tests**

Run: `node --test test/config-degradation.test.js`
Expected: PASS (all 7 tests) — since Tasks 2/4/5 already implement the fail-safe behavior, this should pass immediately and serves as the integration-level confirmation the spec's reliability requirement asks for.

- [ ] **Step 3: Run the entire suite one more time**

Run: `npm test`
Expected: PASS across every test file (live-model phrasing tests SKIP unless `ANTHROPIC_API_KEY` is exported).

- [ ] **Step 4: Commit**

```bash
git add test/config-degradation.test.js
git commit -m "Add full-server config-degradation integration test suite"
```

---

### Task 15: Documentation deliverables — NEW_CLIENT_SETUP.md and README.md

**Files:**
- Create: `NEW_CLIENT_SETUP.md`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing programmatically — this task is documentation only, describing the system built in Tasks 1–14.

- [ ] **Step 1: Write NEW_CLIENT_SETUP.md**

```markdown
# Setting Up a New Client

This codebase is reused as-is for every client. Onboarding a new client
means: duplicate the folder, edit one file, deploy. No code changes.

## 1. Duplicate the project folder

Copy this whole project into a new folder (or a new git repo/branch) named
for the client, e.g. `hvac-chatbot-acme/`.

## 2. Edit `client-config.json`

Copy `client-config.example.json` to `client-config.json` in the new
folder and fill in the client's real info:

- `businessName` — shown in the widget header and greeting.
- `hours.display` — the human-readable hours string shown to visitors.
- `hours.timezone` — an IANA timezone string (e.g. `America/Chicago`) —
  this is what the after-hours check uses.
- `hours.schedule` — one entry per day (`monday`...`sunday`), each either
  `{ "open": "HH:MM", "close": "HH:MM" }` (24-hour time) or `null` for a
  closed day. If you skip this whole file or get it wrong, the bot just
  always acts like it's open — it won't break.
- `serviceArea` — a sentence or two describing where they work.
- `pricing` — a sentence or two describing pricing ranges/policy.
- `services` — a list of services offered.
- `branding.primaryColor` / `branding.accentColor` — hex colors for the
  widget header/accents. Leave as-is to use the default navy/terracotta
  theme.
- `branding.logoUrl` — optional; omit for a text-only header.
- `owner.notificationEmail` — where new-lead emails and the monthly
  recap go.
- `owner.notificationPhone` — reserved for future use; fill in if known.

## 3. Set environment variables

Copy `.env.example` to `.env` and fill in:

- `ANTHROPIC_API_KEY` — same key can be reused across all clients.
- `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` — same Resend account can be
  reused; `NOTIFY_FROM_EMAIL` should be a verified sending address/domain.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — same
  Twilio account can be reused, or use a client-specific number if you
  want the SMS to come from a locally-recognizable number.
- `DATA_DB_PATH` — leave as `./data/leads.sqlite`; each deployed instance
  gets its own file automatically.

## 4. Deploy a new Railway service for this client

1. Create a new Railway project (or a new service within an umbrella
   project) pointing at this client's folder/repo.
2. Add a persistent volume mounted at `./data` so the SQLite file
   survives restarts/redeploys.
3. Set the environment variables from step 3 in Railway's dashboard.
4. Deploy. Railway will run `npm install && npm start`.
5. Note the Railway-provided URL (or attach a subdomain).

## 5. Embed on the client's website

Give the client (or their web developer) this one line to paste before
the closing `</body>` tag on every page they want the bot on:

```html
<script src="https://<their-railway-url>/widget.js" async></script>
```

No other integration is required — the widget renders itself, isolated
in a Shadow DOM, and won't conflict with the rest of the page's styling.

## 6. Verify

- Open the site, confirm the bubble appears bottom-right in the client's
  brand colors.
- Ask a couple of FAQ questions in different phrasings, confirm grounded
  answers.
- Submit a test lead, confirm you receive the owner email and the SMS
  confirmation arrives at your test phone.
- Check `data/leads.sqlite` (or ask them to) to confirm the lead is
  stored.

That's the whole reskin process — typically well under an hour once you
have the client's hours/pricing/service-area text in hand.
```

- [ ] **Step 2: Write README.md**

```markdown
# HVAC Website Chatbot

An embeddable chat widget for local HVAC companies: grounded FAQ
answering (Claude Haiku), lead capture with independent email/SMS
notifications, after-hours awareness, a monthly recap email, and a
missed-question log — all driven by one `client-config.json` file per
deployed instance.

See `NEW_CLIENT_SETUP.md` for how to reskin and redeploy this for a new
client.

## Local setup

```bash
npm install
cp .env.example .env      # fill in your API keys, see below
cp client-config.example.json client-config.json   # or edit in place
npm start
```

The server listens on `PORT` (default `3000`). Open
`http://localhost:3000/api/health` to confirm it's running, and embed the
widget on a local test HTML page with:

```html
<script src="http://localhost:3000/widget.js" async></script>
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (default 3000) | HTTP port |
| `CONFIG_PATH` | no (default `./client-config.json`) | path to the client config file |
| `DATA_DB_PATH` | no (default `./data/leads.sqlite`) | SQLite file location |
| `ANTHROPIC_API_KEY` | yes, for FAQ answering | Claude API key |
| `ANTHROPIC_MODEL` | no (default `claude-haiku-4-5-20251001`) | model id override |
| `RESEND_API_KEY` | yes, for owner email notifications | Resend API key |
| `NOTIFY_FROM_EMAIL` | yes, for owner email notifications | verified Resend sending address |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | yes, for visitor SMS | Twilio credentials |
| `TWILIO_FROM_NUMBER` | yes, for visitor SMS | Twilio phone number, E.164 format |

If any of the above are left unset, that feature degrades gracefully
(e.g. no `ANTHROPIC_API_KEY` → chat falls back to lead capture for every
question; no Twilio creds → SMS is skipped but the lead is still saved
and emailed) rather than crashing the server.

## Running tests

```bash
npm test
```

This runs the full suite via Node's built-in test runner. The FAQ
phrasing reliability suite (`test/faq-phrasing.test.js`) calls the real
Anthropic API and only runs when `ANTHROPIC_API_KEY` is set in the
environment — otherwise it's skipped (not failed), so `npm test` works
without any keys configured. To get the full reliability signal:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm test
```

## Deployment

**Backend + widget assets:** [Railway](https://railway.app). This is a
long-running Node process (not serverless), which is what lets the
SQLite file persist on a mounted volume and lets the monthly recap run
as an in-process scheduled job (`node-cron`) rather than needing an
external cron trigger.

1. Push this folder to a git repo (one repo/branch per client, or one
   repo with per-client deploys — see `NEW_CLIENT_SETUP.md`).
2. Create a Railway service from that repo.
3. Attach a persistent volume mounted at `./data`.
4. Set the environment variables from the table above in Railway's
   dashboard.
5. Deploy — Railway runs `npm install` then `npm start`.
6. Point the client's DNS/subdomain at the Railway service, or use the
   Railway-provided URL directly in the widget `<script>` tag.

**Email:** [Resend](https://resend.com) — verify a sending domain (or use
their shared domain for testing), then set `RESEND_API_KEY` and
`NOTIFY_FROM_EMAIL`.

**SMS:** [Twilio](https://twilio.com) — buy/verify a phone number, set
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

**LLM:** [Anthropic Claude](https://console.anthropic.com) — create an
API key, set `ANTHROPIC_API_KEY`. FAQ answering uses Claude Haiku by
default (fast + inexpensive), overridable via `ANTHROPIC_MODEL`.

## Project structure

```
server/     Express backend: routes, services, db, config loader, jobs
widget/     Embeddable widget (widget.js + widget.css), served statically
test/       node:test suite covering every service, route, and fail-safe
client-config.example.json   Template for the one per-client config file
```
```

- [ ] **Step 3: Commit**

```bash
git add NEW_CLIENT_SETUP.md README.md
git commit -m "Add NEW_CLIENT_SETUP.md and README.md"
```

---

## Self-Review Notes

- **Spec coverage:** FAQ answering (Tasks 6-8), lead capture save/email/SMS independence (Tasks 9-11), after-hours awareness with fail-safe (Task 4), monthly recap (Task 12), missed-question log (Task 7's `missed_questions` insert), one-file config + fast reskin (Tasks 2, 15), Shadow DOM embeddability (Task 13), all named reliability tests (Tasks 8, 11, 14) — every spec section maps to a task.
- **Placeholder scan:** no TBD/TODO markers; every step has real, runnable code.
- **Type consistency checked:** `db.insertLead`/`markLeadNotified`/`getRecapStats` signatures match between Task 3's definition and their call sites in Tasks 11 and 12; `answerQuestion`'s `{ inScope, answer }` return shape matches its use in Task 7; `createApp`'s parameter list is threaded consistently and additively across Tasks 1, 5, 7, 11, 13.
