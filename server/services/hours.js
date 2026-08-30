const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isOpenNow(hoursConfig, now = new Date()) {
  if (!hoursConfig || !hoursConfig.schedule) {
    return true; // fail-safe: no usable schedule means "act like it's open"
  }

  try {
    const timezone = hoursConfig.timezone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(now);

    const weekday = parts.find((p) => p.type === 'weekday').value.toLowerCase();
    let hour = parts.find((p) => p.type === 'hour').value;
    const minute = parts.find((p) => p.type === 'minute').value;
    if (hour === '24') hour = '00';
    const currentTime = `${hour}:${minute}`;

    if (!DAY_NAMES.includes(weekday)) return true; // shouldn't happen, fail-safe anyway

    const todaySchedule = hoursConfig.schedule[weekday];
    if (!todaySchedule || !todaySchedule.open || !todaySchedule.close) {
      return false; // day is explicitly absent/closed, not a config error
    }

    return currentTime >= todaySchedule.open && currentTime < todaySchedule.close;
  } catch (err) {
    console.warn(`[hours] failed to evaluate open/closed state: ${err.message}. Defaulting to open.`);
    return true; // fail-safe on any unexpected error (e.g. bad timezone string)
  }
}

module.exports = { isOpenNow };
