async function sendLeadSms({ twilioClient, config, lead, fromNumber, messagingServiceSid }) {
  if (!twilioClient) {
    console.warn('[notify-sms] no Twilio client configured; skipping.');
    return { ok: false, error: 'no sms client configured' };
  }

  try {
    const params = {
      to: lead.phone,
      body: `Thanks ${lead.name}, got your request for ${config.businessName}. Someone will call you shortly.`
    };
    // A2P 10DLC: prefer sending through the campaign-linked Messaging Service.
    // Fall back to a bare from-number when no service SID is configured.
    if (messagingServiceSid) {
      params.messagingServiceSid = messagingServiceSid;
    } else {
      params.from = fromNumber;
    }
    await twilioClient.messages.create(params);
    return { ok: true };
  } catch (err) {
    console.warn(`[notify-sms] send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendLeadSms };
