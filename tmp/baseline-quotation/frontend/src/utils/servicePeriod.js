export const PERIOD_UNITS = Object.freeze(['days', 'months', 'annual']);

export function normalizeDateInputValue(value) {
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

export function normalizePeriodUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  return PERIOD_UNITS.includes(unit) ? unit : 'annual';
}

function daysInUtcMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addCalendarMonths(value, months) {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const targetMonthIndex = (month - 1) + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(day, daysInUtcMonth(targetYear, normalizedMonthIndex));
  return new Date(Date.UTC(targetYear, normalizedMonthIndex, targetDay)).toISOString().slice(0, 10);
}

export function addServiceDays(value, days) {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function renewalDateFrom(startDate, servicePeriod, periodUnit = 'annual') {
  const quantity = Math.floor(Number(servicePeriod));
  if (!normalizeDateInputValue(startDate) || !Number.isFinite(quantity) || quantity < 1) return '';
  const unit = normalizePeriodUnit(periodUnit);
  return unit === 'days'
    ? addServiceDays(startDate, quantity)
    : addCalendarMonths(startDate, quantity * (unit === 'annual' ? 12 : 1));
}

export function serviceEndDateFrom(startDate, servicePeriod, periodUnit = 'annual') {
  const renewalDate = renewalDateFrom(startDate, servicePeriod, periodUnit);
  return renewalDate ? addServiceDays(renewalDate, -1) : '';
}

export function datesFromAnnualYears(years = []) {
  const sorted = [...new Set(years.map((value) => String(value || '').trim()))]
    .filter((value) => /^\d{4}-\d{2}$/.test(value)).sort();
  if (!sorted.length) return { financialYear: '', serviceStartDate: '', serviceEndDate: '' };
  const firstStart = Number(sorted[0].slice(0, 4));
  const lastStart = Number(sorted.at(-1).slice(0, 4));
  return {
    financialYear: sorted.length === 1 ? sorted[0] : `${sorted[0]} to ${sorted.at(-1)}`,
    serviceStartDate: `${firstStart}-04-01`,
    serviceEndDate: `${lastStart + 1}-03-31`
  };
}

export function periodDisplay(value, unit) {
  const quantity = Math.max(1, Math.floor(Number(value) || 1));
  const normalizedUnit = normalizePeriodUnit(unit);
  const noun = normalizedUnit === 'days' ? 'Day' : normalizedUnit === 'months' ? 'Month' : 'Year';
  return `${quantity} ${noun}${quantity === 1 ? '' : 's'}`;
}
