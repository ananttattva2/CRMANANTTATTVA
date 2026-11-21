const { serviceClosedAt, serviceIdAt } = require('./clientMasterEligibility');
const { resolvePoProof } = require('./poProofResolver');
const norm = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const category = value => norm(value).replace(/^epr/, '');
const offering = value => norm(value).replace(/annualreturnfill?ing|annualfill?ing/g, 'annualreturn');
function sameService(item, service) {
  const applicant = service.subApplicantType || service.piboCategory || service.applicantType;
  return category(service.eprCategory || service.serviceCategory) === category(item.eprCategory || item.serviceCategory)
    && (!item.piboCategory || norm(applicant) === norm(item.piboCategory))
    && (!item.servicesOffered || offering(service.servicesOffered) === offering(item.servicesOffered));
}
function assignmentForService(lead = {}, serviceId = '', index = 0, serviceCount = 1) {
  const assignments = lead.assignments || [];
  const matches = serviceId
    ? assignments.filter(row => String(row.assignedServiceId || row.serviceAssignmentId || '') === String(serviceId))
    : [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return {};
  const indexed = assignments[index];
  const indexedId = String(indexed?.assignedServiceId || indexed?.serviceAssignmentId || '');
  if (indexed && (!serviceId || !indexedId || indexedId === String(serviceId))) return indexed;
  if (assignments.length === 1) {
    const onlyId = String(assignments[0].assignedServiceId || assignments[0].serviceAssignmentId || '');
    if (!serviceId || !onlyId || onlyId === String(serviceId)) return assignments[0];
  }
  return serviceCount <= 1 ? lead : {};
}
function poRowsForQuotation(rows = [], quote = {}) {
  const quoteId = String(quote._id || quote.id || '');
  const quoteNumber = String(quote.quotationNumber || '').trim().toUpperCase();
  const linkedRows = rows.filter(row => String(row?.quotationId?._id || row?.quotationId || row?.quotationNumber || row?.quotationNo || '').trim());
  if (!linkedRows.length) return rows;
  return rows.filter(row => {
    const rowQuoteId = String(row?.quotationId?._id || row?.quotationId || '');
    const rowQuoteNumber = String(row?.quotationNumber || row?.quotationNo || '').trim().toUpperCase();
    return Boolean((quoteId && rowQuoteId === quoteId) || (quoteNumber && rowQuoteNumber === quoteNumber));
  });
}
function eligibleItems(quote = {}, lead = {}) {
  const services = lead.serviceSelections?.length ? lead.serviceSelections : [lead];
  return (quote.items || []).flatMap((item, sourceItemIndex) => {
    let index = item.assignedServiceId ? services.findIndex((_, i) => serviceIdAt(lead, i) === item.assignedServiceId) : -1;
    if (index < 0 && Number.isInteger(item.sourceServiceIndex) && sameService(item, services[item.sourceServiceIndex] || {})) index = item.sourceServiceIndex;
    if (index < 0) {
      const matches = services.map((service, i) => ({ service, i })).filter(({ service }) => sameService(item, service));
      if (matches.length === 1) index = matches[0].i;
    }
    if (index < 0 || index >= services.length) return [];
    const id = serviceIdAt(lead, index);
    const assignment = assignmentForService(lead, id, index, services.length);
    if (!serviceClosedAt({ ...lead, serviceSelections: [services[index]], assignments: [assignment], closedBy: services.length === 1 ? lead.closedBy : null, closedByText: services.length === 1 ? lead.closedByText : '', closedAt: services.length === 1 ? lead.closedAt : null }, 0) && !assignment.closureRequestedBy && !assignment.closureRequestedByText && !assignment.permanentClosedAt && !(services.length === 1 && /^closed(?: won)?$/i.test(String(lead.status || '')))) return [];
    if (assignment.poStatus && !['received', 'yes'].includes(norm(assignment.poStatus))) return [];
    if (/rejected|revision_required/i.test(assignment.poApprovalStatus || '')) return [];
    const orders = assignment.poYearRows?.length ? assignment.poYearRows : assignment.originalPoDetails ? [assignment.originalPoDetails] : [assignment];
    if (!poRowsForQuotation(orders, quote).some(po => {
      const poNumber = String(po.poNumber || po.poNo || '').trim();
      return poNumber && norm(poNumber) !== norm(quote.quotationNumber)
        && resolvePoProof({ ...po, poFile: po.poFile || po.compliancePoFile }).url;
    })) return [];
    return [{ ...item, sourceServiceIndex: index, sourceItemIndex, assignedServiceId: id || item.assignedServiceId }];
  });
}
module.exports = { eligibleItems, assignmentForService, poRowsForQuotation };
