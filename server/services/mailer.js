// Thin wrapper over Brevo's HTTPS transactional email API. Exposes a single
// `sendMail({ from, to, subject, text })` method so notify-email.js and
// monthly-recap.js never touch a provider directly. Returns null when no API
// key is configured, which those callers treat as "email disabled".
//
// Brevo (HTTPS) is used rather than SMTP because Railway blocks outbound SMTP
// ports on lower tiers. Uses Node's built-in fetch (Node >=18) - no SDK
// dependency needed.
function createMailer(env = process.env) {
  if (!env.BREVO_API_KEY) return null;

  return {
    async sendMail({ from, to, subject, text }) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          sender: { email: from },
          to: [{ email: to }],
          subject,
          textContent: text
        })
      });

      if (!res.ok) {
        let detail;
        try {
          const body = await res.json();
          detail = body && body.message ? body.message : JSON.stringify(body);
        } catch {
          detail = await res.text().catch(() => res.statusText);
        }
        throw new Error(`Brevo send failed (${res.status}): ${detail}`);
      }
    }
  };
}

module.exports = { createMailer };
