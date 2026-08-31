async function sendLeadEmail({ resendClient, config, lead, fromEmail }) {
  if (!config.owner || !config.owner.notificationEmail) {
    console.warn('[notify-email] no owner notification email configured; skipping.');
    return { ok: false, error: 'no owner email configured' };
  }
  if (!resendClient) {
    console.warn('[notify-email] no Resend client configured; skipping.');
    return { ok: false, error: 'no email client configured' };
  }

  try {
    const { data, error } = await resendClient.emails.send({
      from: fromEmail,
      to: config.owner.notificationEmail,
      subject: `New lead for ${config.businessName}: ${lead.name}`,
      text: `New lead from the website chatbot.\n\nName: ${lead.name}\nPhone: ${lead.phone}\nReason: ${lead.reason || '(not provided)'}\n`
    });
    if (error) {
      console.warn(`[notify-email] send failed: ${error.message || String(error)}`);
      return { ok: false, error: error.message || String(error) };
    }
    return { ok: true };
  } catch (err) {
    console.warn(`[notify-email] send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendLeadEmail };
