function parseDate(dateInput) {
  const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${dateInput}`);
  }
  return date;
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

// Advance by market weekdays. This deliberately does not pretend to model a
// specific exchange's holiday calendar, but it keeps daily-bar horizons from
// counting Saturdays and Sundays as forecast sessions.
export function addTradingDays(dateInput, days) {
  const steps = Number(days);
  if (!Number.isInteger(steps) || steps < 0) {
    throw new TypeError('Trading-day steps must be a non-negative integer.');
  }

  const date = parseDate(dateInput);
  let remaining = steps;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return formatUtcDate(date);
}
