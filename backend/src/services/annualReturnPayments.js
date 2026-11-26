const text = value => String(value ?? '').trim();

function financialYearStart(value) {
  const match = /^(20\d{2})[-–](\d{2})$/.exec(text(value));
  if (!match || (Number(match[1]) + 1) % 100 !== Number(match[2])) return null;
  return Number(match[1]);
}

function annualReturnYear(po, service) {
  const saved = financialYearStart(po.annualReturnYear);
  const fy = financialYearStart(po.poFinancialYear) ?? financialYearStart(po.fy);
  const start = saved ?? (fy === null ? financialYearStart(service.firstAnnualReturnYearApplicable) : fy - 1);
  return start === null ? '' : start + '-' + String(start + 1).slice(-2);
}

function annualPaymentSchedule(approval) {
  const { service = {}, poYearRows = [] } = approval.payload || {};
  const offering = [service.servicesOffered, service.applicableService, ...poYearRows.flatMap(row => row.services || [])].join(' ');
  if (!/\bannual\s*(?:return|fil+l?ing)\b/i.test(offering) || !poYearRows.length) return [];
  const years = new Map();
  for (const po of poYearRows) {
    const year = annualReturnYear(po, service);
    if (!year) return [];
    if (!years.has(year)) years.set(year, []);
    years.get(year).push(po);
  }
  return [...years].sort(([a], [b]) => a.localeCompare(b)).map(([year, rows]) => ({
    year, rows,
    amount: rows.reduce((sum, po) => sum + (Number(po.poAmount) || 0), 0),
    payment: approval.poReview?.annualPayments?.[year] ?? (years.size === 1 ? approval.poReview?.paymentStatus : null)
  }));
}

function paymentSeriesKey(approval) {
  const { leadId, service = {}, poYearRows = [] } = approval.payload || {};
  const normalize = value => text(value).toLowerCase().replace(/\s+/g, ' ');
  const numbers = [...new Set(poYearRows.map(po => normalize(po.poNumber || po.poNo)).filter(Boolean))];
  if (!leadId || numbers.length !== 1) return 'approval:' + approval._id;
  return JSON.stringify([String(leadId), numbers[0], normalize(service.eprCategory), normalize(service.subApplicantType || service.piboCategory || service.applicantType), normalize(service.plantUnit)]);
}

const indiaYearMonth = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric'
});

function annualPaymentQueue(approvals, now = new Date()) {
  const parts = indiaYearMonth.formatToParts(now);
  const yearNow = Number(parts.find(part => part.type === 'year').value);
  const monthNow = Number(parts.find(part => part.type === 'month').value);
  const currentAnnualReturnStart = yearNow - (monthNow >= 4 ? 1 : 2);
  const groups = new Map();
  const byApproval = new Map();
  for (const approval of approvals) {
    const schedule = annualPaymentSchedule(approval);
    if (!schedule.length) continue;
    const key = paymentSeriesKey(approval);
    if (!groups.has(key)) groups.set(key, []);
    for (const row of schedule) groups.get(key).push({ ...row, approvalId: String(approval._id) });
    byApproval.set(String(approval._id), []);
  }
  for (const entries of groups.values()) {
    const years = [...new Set(entries.map(row => row.year))].sort();
    let waitingForYear = null;
    for (const year of years) {
      const current = entries.filter(row => row.year === year);
      const laterPayment = entries.some(row => row.year > year && row.payment);
      for (const row of current) {
        byApproval.get(row.approvalId).push({ ...row, unlocked: !waitingForYear, waitingForYear, further: financialYearStart(year) > currentAnnualReturnStart || year !== years[0], laterPayment });
      }
      if (!waitingForYear && current.some(row => row.payment?.status !== 'COMPLETE_RECEIVED')) waitingForYear = year;
    }
  }
  return byApproval;
}

module.exports = { annualReturnYear, annualPaymentSchedule, annualPaymentQueue };
