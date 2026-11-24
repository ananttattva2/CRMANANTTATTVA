function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validationError(sla = {}) {
  if (!validDate(sla.fromDate)) return 'SLA From Date is required and must be a valid date.';
  if (!validDate(sla.toDate)) return 'SLA To Date is required and must be a valid date.';
  if (sla.toDate < sla.fromDate) return 'SLA To Date must be on or after From Date.';
  if (sla.status && !['Yes', 'No'].includes(sla.status)) return 'SLA Status must be Yes or No.';
  return '';
}
function cleanSla(input = {}) {
  return {
    status: ['Yes', 'No'].includes(input.status) ? input.status : '',
    remark: String(input.remark || '').trim().slice(0, 2000),
    fromDate: String(input.fromDate || '').trim(),
    toDate: String(input.toDate || '').trim(),
    proofs: (Array.isArray(input.proofs) ? input.proofs : []).slice(0, 20).filter(file => /^https:\/\//i.test(String(file?.secureUrl || file?.url || ''))).map(file => ({
      name: String(file.name || 'SLA proof').slice(0, 240),
      url: String(file.secureUrl || file.url),
      secureUrl: String(file.secureUrl || file.url),
      publicId: String(file.publicId || '').slice(0, 500),
      type: String(file.type || file.mimeType || '').slice(0, 120),
      size: Math.max(0, Number(file.size) || 0)
    }))
  };
}
module.exports = { validDate, validationError, cleanSla };
