const PERIOD_UNITS = Object.freeze(['days', 'months', 'annual']);

function normalizeDateOnly(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizePeriodUnit(value, { allowMissing = true } = {}) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw && allowMissing) return 'annual';
  if (!PERIOD_UNITS.includes(raw)) throw new Error('Select Period must be Days, Months, or Years.');
  return raw;
}

function validateServicePeriod(value, unit) {
  const quantity = Number(value);
  const max = unit === 'days' ? 3650 : unit === 'months' ? 600 : 100;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
    throw new Error(`Service Period must be a whole number between 1 and ${max}.`);
  }
  return quantity;
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addCalendarMonths(value, months) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const targetMonthIndex = (month - 1) + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(day, daysInUtcMonth(targetYear, normalizedMonthIndex));
  return new Date(Date.UTC(targetYear, normalizedMonthIndex, targetDay)).toISOString().slice(0, 10);
}

function addDays(value, days) {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function renewalDateFrom(startDate, servicePeriod, periodUnit = 'annual') {
  const unit = normalizePeriodUnit(periodUnit);
  const quantity = validateServicePeriod(servicePeriod, unit);
  return unit === 'days'
    ? addDays(startDate, quantity)
    : addCalendarMonths(startDate, quantity * (unit === 'annual' ? 12 : 1));
}

function serviceEndDateFrom(startDate, servicePeriod, periodUnit = 'annual') {
  const renewalDate = renewalDateFrom(startDate, servicePeriod, periodUnit);
  return renewalDate ? addDays(renewalDate, -1) : '';
}

function datesFromAnnualYears(years = []) {
  const sorted = [...new Set(years.map((value) => String(value || '').trim()))]
    .filter((value) => /^\d{4}-\d{2}$/.test(value)).sort();
  if (!sorted.length) return { serviceStartDate: '', serviceEndDate: '' };
  const firstStart = Number(sorted[0].slice(0, 4));
  const lastStart = Number(sorted.at(-1).slice(0, 4));
  return { serviceStartDate: `${firstStart}-04-01`, serviceEndDate: `${lastStart + 1}-03-31` };
}

module.exports = {
  PERIOD_UNITS,
  addCalendarMonths,
  addDays,
  datesFromAnnualYears,
  normalizeDateOnly,
  normalizePeriodUnit,
  renewalDateFrom,
  serviceEndDateFrom,
  validateServicePeriod
};
