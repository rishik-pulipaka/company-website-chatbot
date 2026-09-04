async function sendLeadEmail({ mailer, config, lead, fromEmail }) {
  if (!config.owner || !config.owner.notificationEmail) {
    console.warn('[notify-email] no owner notification email configured; skipping.');
    return { ok: false, error: 'no owner email configured' };
  }
  if (!mailer) {
    console.warn('[notify-email] no mailer configured; skipping.');
    return { ok: false, error: 'no email client configured' };
  }

  try {
    await mailer.sendMail({
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
