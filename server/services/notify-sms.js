async function sendLeadSms({ twilioClient, config, lead, fromNumber }) {
  if (!twilioClient) {
    console.warn('[notify-sms] no Twilio client configured; skipping.');
    return { ok: false, error: 'no sms client configured' };
  }

  try {
    await twilioClient.messages.create({
      to: lead.phone,
      from: fromNumber,
      body: `Thanks ${lead.name}, got your request for ${config.businessName}. Someone will call you shortly.`
    });
    return { ok: true };
  } catch (err) {
    console.warn(`[notify-sms] send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendLeadSms };
