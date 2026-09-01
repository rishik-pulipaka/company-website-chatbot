const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { createConfigRouter } = require('./routes/config.js');
const { createChatRouter } = require('./routes/chat.js');
const { createLeadRouter } = require('./routes/lead.js');
const { createPublicApiLimiter } = require('./middleware/rate-limit.js');

function createApp({
  config,
  db,
  anthropicClient,
  resendClient,
  twilioClient,
  model,
  fromEmail,
  fromNumber,
  rateLimit
} = {}) {
  const app = express();
  // Trust exactly one hop of reverse proxy (Railway sits in front of this app in
  // production), so Express derives req.ip from X-Forwarded-For correctly. Without
  // this, express-rate-limit v7 throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR whenever it
  // sees that header, and rate limiting would otherwise key on the proxy's IP for
  // every visitor instead of the real client IP.
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'widget')));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  if (config) {
    app.use('/api', createConfigRouter(config));
  }
  if (config && db) {
    app.use('/api/chat', createPublicApiLimiter(rateLimit));
    app.use('/api/lead', createPublicApiLimiter(rateLimit));
    app.use('/api', createChatRouter({ config, db, anthropicClient, model }));
    app.use('/api', createLeadRouter({ config, db, resendClient, twilioClient, fromEmail, fromNumber }));
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
    fromNumber: process.env.TWILIO_FROM_NUMBER,
    rateLimit: {
      windowMs: process.env.RATE_LIMIT_WINDOW_MS ? Number(process.env.RATE_LIMIT_WINDOW_MS) : undefined,
      max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : undefined
    }
  });
  app.listen(port, () => {
    console.log(`hvac-chatbot listening on port ${port}`);
  });

  const { scheduleMonthlyRecap } = require('./jobs/monthly-recap.js');
  if (resendClient) {
    scheduleMonthlyRecap({ db, config, resendClient, fromEmail: process.env.NOTIFY_FROM_EMAIL });
  }
}
