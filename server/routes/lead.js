const express = require('express');
const { sendLeadEmail } = require('../services/notify-email.js');
const { sendLeadSms } = require('../services/notify-sms.js');

const MAX_NAME_LENGTH = 200;
const MAX_REASON_LENGTH = 2000;
const PHONE_PATTERN = /^\+?[1-9]\d{6,14}$/;

function looksLikePhoneNumber(phone) {
  if (typeof phone !== 'string') return false;
  const stripped = phone.replace(/[\s\-().]/g, '');
  return PHONE_PATTERN.test(stripped);
}

function createLeadRouter({ config, db, mailer, twilioClient, fromEmail, fromNumber, messagingServiceSid }) {
  const router = express.Router();

  router.post('/lead', async (req, res) => {
    const { sessionId, name, phone, reason } = req.body || {};
    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }
    if (typeof name === 'string' && name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: `name must be ${MAX_NAME_LENGTH} characters or fewer` });
    }
    if (typeof reason === 'string' && reason.length > MAX_REASON_LENGTH) {
      return res.status(400).json({ error: `reason must be ${MAX_REASON_LENGTH} characters or fewer` });
    }
    if (!looksLikePhoneNumber(phone)) {
      return res.status(400).json({ error: 'phone does not look like a valid phone number' });
    }

    let leadId;
    try {
      const conversationId = sessionId ? db.insertConversation(sessionId) : null;
      leadId = db.insertLead({ conversationId, name, phone, reason });
    } catch (err) {
      // The one hard failure per spec: we cannot silently drop a lead.
      console.error(`[lead] FAILED TO SAVE LEAD: ${err.message}`, { name, phone, reason });
      return res.status(500).json({
        error: 'We could not save your request right now. Please call us directly.'
      });
    }

    const lead = { name, phone, reason };

    // The lead is saved — that's the only thing the visitor's confirmation depends
    // on, so respond now. Email and SMS run in the background: a slow or
    // misconfigured provider must never delay or block the visitor (a broken SMTP
    // host, for example, can hang for two minutes before timing out).
    res.json({ ok: true, leadId });

    const notified = Promise.allSettled([
      sendLeadEmail({ mailer, config, lead, fromEmail }),
      sendLeadSms({ twilioClient, config, lead, fromNumber, messagingServiceSid })
    ]).then(([emailResult, smsResult]) => {
      const emailOk = emailResult.status === 'fulfilled' && emailResult.value.ok;
      const smsOk = smsResult.status === 'fulfilled' && smsResult.value.ok;
      try {
        db.markLeadNotified({ leadId, emailSent: emailOk, smsSent: smsOk });
      } catch (err) {
        console.error(`[lead] FAILED TO MARK NOTIFICATION STATUS: ${err.message}`, { leadId });
      }
    });

    // Surface the in-flight notification work so tests can await it. Never rejects
    // (Promise.allSettled), so no unhandled-rejection risk in production.
    router.lastNotified = notified;
  });

  return router;
}

module.exports = { createLeadRouter };
