const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const IST_OFFSET_MS = 330 * 60 * 1000;
const CLIENT_CORRECTION_DEADLINE_POLICY = 'skip_first_third_saturday_96h_v2';

function isFirstOrThirdSaturdayInIst(value) {
  const ist = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  if (Number.isNaN(ist.getTime()) || ist.getUTCDay() !== 6) return false;
  const occurrence = Math.ceil(ist.getUTCDate() / 7);
  return occurrence === 1 || occurrence === 3;
}

function nextIstDayStart(value) {
  const ist = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - IST_OFFSET_MS);
}

function addClientCorrectionHours(start, hours) {
  let cursor = new Date(start);
  let remaining = Math.max(0, Number(hours) || 0) * HOUR_MS;
  if (Number.isNaN(cursor.getTime())) throw new Error('Invalid Client Master correction start date');

  while (remaining > 0) {
    const nextDay = nextIstDayStart(cursor);
    if (isFirstOrThirdSaturdayInIst(cursor)) {
      cursor = nextDay;
      continue;
    }
    const step = Math.min(remaining, nextDay.getTime() - cursor.getTime());
    cursor = new Date(cursor.getTime() + step);
    remaining -= step;
  }
  return cursor;
}

module.exports = { CLIENT_CORRECTION_DEADLINE_POLICY, DAY_MS, addClientCorrectionHours, isFirstOrThirdSaturdayInIst };
