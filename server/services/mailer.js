// Thin wrapper over SendGrid's HTTPS API. Exposes a single
// `sendMail({ from, to, subject, text })` method so notify-email.js and
// monthly-recap.js never touch a provider SDK directly. Returns null when no
// API key is configured, which those callers treat as "email disabled".
//
// SendGrid (HTTPS) is used rather than SMTP because Railway blocks outbound
// SMTP ports on lower tiers.
function createMailer(env = process.env) {
  if (!env.SENDGRID_API_KEY) return null;
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(env.SENDGRID_API_KEY);
  return {
    sendMail: ({ from, to, subject, text }) => sgMail.send({ from, to, subject, text })
  };
}

module.exports = { createMailer };
