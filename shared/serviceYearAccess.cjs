function yearLabel(value) {
  const match = String(value || '').match(/\b(20\d{2})/);
  return match ? `${match[1]}-${String(Number(match[1]) + 1).slice(-2)}` : '';
}
function currentAnnualYear(now = new Date()) {
  const local = new Date(+new Date(now) + 330 * 60000);
  const start = local.getUTCFullYear() - (local.getUTCMonth() < 3 ? 1 : 0) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
function annualYearAccess(year, now = new Date()) {
  const current = currentAnnualYear(now), normalized = yearLabel(year);
  const start = normalized ? Number(normalized.slice(0, 4)) : null;
  const unlock = start ? `${start + 1}-${String(start + 2).slice(-2)}` : '';
  return { allowed: normalized === current, currentYear: current, message: `Only the current Annual Return Year ${current} can be opened.${normalized && normalized > current ? ` Annual Return ${normalized} opens in financial year ${unlock}.` : ' This service year is frozen.'}` };
}
function isRegistration(service) { return /^(?:new\s+)?registration$/i.test(String(service || '').trim()); }
module.exports = { yearLabel, currentAnnualYear, annualYearAccess, isRegistration };
