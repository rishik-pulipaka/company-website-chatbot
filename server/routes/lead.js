const express = require('express');
const { sendLeadEmail } = require('../services/notify-email.js');
const { sendLeadSms } = require('../services/notify-sms.js');

function createLeadRouter({ config, db, resendClient, twilioClient, fromEmail, fromNumber }) {
  const router = express.Router();

  router.post('/lead', async (req, res) => {
    try {
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
    } catch (error) {
      console.error('Error in /api/lead route:', error);
      res.status(500).json({ error: 'Something went wrong. Please try again or leave your contact info.' });
    }
  });

  return router;
}

module.exports = { createLeadRouter };
