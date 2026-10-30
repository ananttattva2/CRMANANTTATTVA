const { createHash } = require('node:crypto');
function amountPaise(value) {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a positive amount with at most 2 decimal places.');
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Revenue must be greater than zero.');
  return amount;
}
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
    group.contributions.push({ id: String(entry._id), amountPaise: entry.amountPaise, services: entry.services, createdByName: entry.createdByName, createdAt: entry.createdAt });
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
module.exports = { amountPaise, serviceRows, groupsFrom, hotClosed };
