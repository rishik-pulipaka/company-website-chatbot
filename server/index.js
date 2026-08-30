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
