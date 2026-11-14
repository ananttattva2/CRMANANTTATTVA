const { createHash } = require('node:crypto');
const { userHasAnyRole } = require('../utils/userRoles');
const ACTIVE_STAGES = ['FINANCE_READY', 'MANAGEMENT_PENDING', 'FINANCE_RELEASED'];
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value?.toHexString) return value.toHexString();
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined && value[key] !== null && value[key] !== '' && value[key] !== 0 && !(Array.isArray(value[key]) && !value[key].length)).map(key => [key, canonical(value[key])]));
}
function sourceSignature(assignment = {}, service = {}) {
  return createHash('sha256').update(JSON.stringify(canonical({
    service: Object.fromEntries(['assignedServiceId', 'eprCategory', 'applicantType', 'subApplicantType', 'piboCategory', 'servicesOffered', 'applicableService', 'financialYear', 'firstAnnualReturnYearApplicable'].map(key => [key, service[key]])),
    poStatus: assignment.poStatus || '', quotationSent: assignment.quotationSent || '',
    poYearRows: (assignment.poYearRows || []).map(row => ({ ...row, currency: String(row.currency || 'INR').toUpperCase(), poAmount: Number(row.poAmount) || 0, quotationBasicAmount: Number(row.quotationBasicAmount) || 0, poFileSize: Number(row.poFileSize) || 0 })), earlierQuotationProofUrl: assignment.earlierQuotationProofUrl || ''
  }))).digest('hex');
}
function transition(review, event, user, remarks, expectedVersion, now = new Date()) {
  const text = String(remarks || '').trim();
  if (!text || text.length > 2500) fail(400, 'Enter remarks between 1 and 2,500 characters.');
  const rules = {
    ADMIN_APPROVE: { roles: ['admin', 'superadmin'], from: null, to: 'FINANCE_READY' },
    FINANCE_APPROVE: { roles: ['accounts'], from: 'FINANCE_READY', to: 'FINALIZED' },
    FINANCE_REFER: { roles: ['accounts'], from: 'FINANCE_READY', to: 'MANAGEMENT_PENDING' },
    MANAGEMENT_GO_AHEAD: { roles: ['superadmin'], from: 'MANAGEMENT_PENDING', to: 'FINANCE_RELEASED' },
    FINANCE_FINAL: { roles: ['accounts'], from: 'FINANCE_RELEASED', to: 'FINALIZED' }
  };
  const rule = rules[event];
  if (!rule || !userHasAnyRole(user, rule.roles)) fail(403, event === 'MANAGEMENT_GO_AHEAD' ? 'Only Super Admin can give Management Go Ahead.' : 'Your role cannot perform this approval step.');
  if ((review?.stage || null) !== rule.from) fail(409, 'This PO is not ready for that action. Refresh the approval list.');
  if (event !== 'ADMIN_APPROVE' && Number(expectedVersion) !== review.version) fail(409, 'This PO changed after you opened it. Refresh and try again.');
  const entry = { event, remarks: text, by: String(user._id), name: user.name || user.email || '', at: now.toISOString() };
  return { ...(review || {}), stage: rule.to, frozen: rule.to === 'MANAGEMENT_PENDING', version: (review?.version || 0) + 1,
    history: [...(review?.history || []), entry],
    ...(event === 'ADMIN_APPROVE' ? { adminApproval: entry } : {}),
    ...(event === 'FINANCE_APPROVE' ? { financeFinal: entry } : {}),
    ...(event === 'FINANCE_REFER' ? { financeReferral: entry } : {}),
    ...(event === 'MANAGEMENT_GO_AHEAD' ? { managementGoAhead: entry } : {}),
    ...(event === 'FINANCE_FINAL' ? { financeFinal: entry } : {}) };
}
function termsSnapshot(rows = [], quotations = []) {
  return rows.map((row, index) => {
    const quotation = quotations.find(quote => String(quote._id) === String(row.quotationId || ''))
      || quotations.find(quote => row.quotationNumber && quote.quotationNumber === row.quotationNumber);
    return { poNumber: String(row.poNumber || row.poNo || `PO ${index + 1}`), quotationNumber: row.quotationNumber || quotation?.quotationNumber || '',
      paymentTerm: String(row.paymentTerm || quotation?.paymentTerm || ''),
      customTerms: [...new Set([...(quotation?.terms || []), ...(Array.isArray(row.terms) ? row.terms : []), ...(Array.isArray(row.customTerms) ? row.customTerms : [])].map(value => String(value).trim()).filter(Boolean))] };
  });
}
module.exports = { ACTIVE_STAGES, transition, sourceSignature, termsSnapshot, fail };
