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
