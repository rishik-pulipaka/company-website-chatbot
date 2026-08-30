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
