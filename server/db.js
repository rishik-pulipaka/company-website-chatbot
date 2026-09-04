const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  answered_from_config INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  email_sent INTEGER NOT NULL DEFAULT 0,
  sms_sent INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT
);

CREATE TABLE IF NOT EXISTS missed_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id),
  question_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS recap_log (
  year_month TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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

  // Migrations for databases created before a column existed. ALTER TABLE throws
  // "duplicate column name" if it's already there — safe to ignore.
  for (const stmt of ["ALTER TABLE leads ADD COLUMN notified_at TEXT"]) {
    try {
      raw.exec(stmt);
    } catch (err) {
      if (!/duplicate column name/i.test(err.message)) throw err;
    }
  }

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
      .prepare(
        "UPDATE leads SET email_sent = ?, sms_sent = ?, notified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
      )
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
