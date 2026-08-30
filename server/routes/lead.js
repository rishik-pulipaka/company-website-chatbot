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

    // Wrap markLeadNotified in its own try/catch that logs but doesn't affect response.
    // Once the lead is saved, we must return success regardless of post-save failures.
    try {
      db.markLeadNotified({ leadId, emailSent: emailOk, smsSent: smsOk });
    } catch (err) {
      console.error(`[lead] FAILED TO MARK NOTIFICATION STATUS: ${err.message}`, { leadId });
    }

    res.json({ ok: true, leadId });
  });

  return router;
}

module.exports = { createLeadRouter };
