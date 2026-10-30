const { createHash } = require('node:crypto');
const { parseRevenuePaise: amountPaise } = require('../utils/revenueAmount');
function serviceRows(lead, kind) {
  if (kind === 'cold') return [{ key: 'cold-base', label: 'Cold lead estimated revenue', owner: String(lead.createdBy?._id || lead.createdBy || '') }];
  const rows = lead.serviceSelections?.length ? lead.serviceSelections : [];
  return rows.map((row, index) => ({
    key: String(row.assignedServiceId || row.serviceAssignmentId || `legacy-${index}-${createHash('sha256').update(JSON.stringify([row.eprCategory, row.servicesOffered, row.applicantType, row.firstAnnualReturnYearApplicable])).digest('hex').slice(0, 16)}`),
    label: [row.eprCategory, row.servicesOffered, row.applicantType].filter(Boolean).join(' · ') || `Service ${index + 1}`,
    owner: String(row.createdByCrmUserId || lead.createdBy?._id || lead.createdBy || '')
  }));
}
function groupsFrom(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.groupId)) groups.set(entry.groupId, { id: entry.groupId, amountPaise: 0, contributions: [] });
    const group = groups.get(entry.groupId);
    group.amountPaise += entry.amountPaise;
    group.contributions.push({ id: String(entry._id), amountPaise: entry.amountPaise, services: entry.services, createdByName: entry.createdByName, createdAt: entry.createdAt, corrections: entry.corrections || [] });
  }
  return [...groups.values()];
}
function hotClosed(lead) {
  const rows = lead.serviceSelections?.length ? lead.serviceSelections : [lead];
  return rows.every((row, i) => {
    const assignment = (lead.assignments || []).find(a => row.assignedServiceId && a.assignedServiceId === row.assignedServiceId) || lead.assignments?.[i] || {};
    return Boolean(row.closedBy || row.closedByText || row.closedAt || assignment.closedBy || assignment.closedByText || assignment.closedAt || (rows.length === 1 && (lead.closedBy || lead.closedByText || lead.closedAt)))
      || /^(closed|closed won|closed lost)$/i.test(String(row.status || lead.status || '').trim());
  });
}
function purchaseOrders(lead = {}) {
  const unique = new Map();
  const assignments = lead.assignments?.length ? lead.assignments : [lead];
  assignments.forEach((assignment, index) => {
    if ((assignment.poStatus && assignment.poStatus !== 'received') || /rejected/i.test(assignment.poApprovalStatus || '')) return;
    const rows = assignment.poYearRows?.length ? assignment.poYearRows : assignment.originalPoDetails ? [assignment.originalPoDetails] : [assignment];
    rows.forEach((po, rowIndex) => {
      const amount = Number(po.poAmount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const number = String(po.poNumber || po.poNo || '').trim();
      const key = number ? [number.toUpperCase(), po.poDate || '', po.poFinancialYear || po.fy || ''].join('|') : `unnumbered:${index}:${rowIndex}`;
      const value = { number: number || 'Not numbered', date: po.poDate || '', amountPaise: Math.round(amount * 100) };
      if (!unique.has(key) || unique.get(key).amountPaise < value.amountPaise) unique.set(key, value);
    });
  });
  return [...unique.values()];
}
function serviceDetails(lead = {}) {
  const rows = lead.serviceSelections?.length ? lead.serviceSelections : [lead];
  return rows.map((row, index) => {
    const assignment = (lead.assignments || []).find(a => row.assignedServiceId && a.assignedServiceId === row.assignedServiceId) || lead.assignments?.[index] || {};
    return { id: row.assignedServiceId || `service-${index}`, category: row.eprCategory || '', offering: row.servicesOffered || row.applicableService || '', applicant: row.subApplicantType || row.piboCategory || row.applicantType || '', year: row.firstAnnualReturnYearApplicable || row.financialYear || '', closed: hotClosed({ ...(rows.length === 1 ? lead : { status: lead.status }), ...row, serviceSelections: [row], assignments: [assignment] }), manager: assignment.assignedToText || '', staff: assignment.assignedStaffText || '' };
  });
}
function clientContactDetails(lead = {}) {
  const contact = lead.contacts?.[0] || {};
  const address = lead.addresses?.[0] || {};
  return {
    company: lead.company || lead.clientName || '',
    contactPerson: lead.contactPerson || lead.personName || contact.contactPerson || '',
    email: lead.emails || lead.email || contact.emails || '',
    phone: lead.mobileNo1 || lead.phone || contact.mobileNo1 || '',
    communicationMode: lead.communicationMode || '',
    communicationNote: lead.communicationModeNote || '',
    industry: lead.industryType || lead.sector || '',
    address: [lead.addressLine1 || address.addressLine1, lead.addressLine2 || address.addressLine2, lead.addressLine3 || address.addressLine3].filter(Boolean).join(', '),
    city: lead.city || address.city || '', state: lead.state || address.state || '', pinCode: lead.pinCode || address.pinCode || ''
  };
}
module.exports = { amountPaise, serviceRows, groupsFrom, hotClosed, purchaseOrders, serviceDetails, clientContactDetails };
