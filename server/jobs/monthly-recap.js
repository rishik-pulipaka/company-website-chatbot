const cron = require('node-cron');

function previousMonthRange(now) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; "this month" start
  const prevMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const thisMonthStart = new Date(Date.UTC(year, month, 1));
  const yearMonth = `${prevMonthStart.getUTCFullYear()}-${String(prevMonthStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return { sinceIso: prevMonthStart.toISOString(), untilIso: thisMonthStart.toISOString(), yearMonth };
}

async function runMonthlyRecapIfDue({ db, config, mailer, fromEmail, now = new Date() }) {
  const { sinceIso, untilIso, yearMonth } = previousMonthRange(now);

  if (db.hasRecapBeenSent(yearMonth)) {
    return { sent: false, reason: 'already sent for this month' };
  }

  if (!config.owner || !config.owner.notificationEmail || !mailer) {
    console.warn('[monthly-recap] no owner email or email client configured; skipping recap send.');
    return { sent: false, reason: 'no owner email or email client configured' };
  }

  const stats = db.getRecapStats({ sinceIso, untilIso });

  try {
    await mailer.sendMail({
      from: fromEmail,
      to: config.owner.notificationEmail,
      subject: `${config.businessName} chatbot recap for ${yearMonth}`,
      text: `Here's your monthly chatbot recap for ${yearMonth}:\n\n${stats.conversationCount} conversation${stats.conversationCount === 1 ? '' : 's'} handled\n${stats.leadCount} lead${stats.leadCount === 1 ? '' : 's'} captured\n`
    });
    db.markRecapSent(yearMonth);
    return { sent: true };
  } catch (err) {
    console.warn(`[monthly-recap] send failed: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

function scheduleMonthlyRecap({ db, config, mailer, fromEmail }) {
  // Runs daily at 06:00 server time; the "already sent this month" check inside
  // runMonthlyRecapIfDue makes this safe to check every day without duplicate sends.
  cron.schedule('0 6 * * *', () => {
    runMonthlyRecapIfDue({ db, config, mailer, fromEmail }).catch((err) => {
      console.error(`[monthly-recap] unexpected error: ${err.message}`);
    });
  });
}

module.exports = { runMonthlyRecapIfDue, scheduleMonthlyRecap, previousMonthRange };
