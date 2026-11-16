const { serviceClosedAt, serviceIdAt } = require('./clientMasterEligibility');
const norm = value => String(value || '').trim().toLowerCase();
function eligibleItems(quote = {}, lead = {}) {
  const services = lead.serviceSelections?.length ? lead.serviceSelections : [lead];
  return (quote.items || []).flatMap((item, sourceItemIndex) => {
    let index = item.assignedServiceId ? services.findIndex((_, i) => serviceIdAt(lead, i) === item.assignedServiceId) : -1;
    if (item.assignedServiceId && index < 0) return [];
    if (index < 0 && Number.isInteger(item.sourceServiceIndex)) index = item.sourceServiceIndex;
    if (index < 0) {
      const matches = services.map((service, i) => ({ service, i })).filter(({ service }) =>
        norm(service.eprCategory || service.serviceCategory) === norm(item.eprCategory || item.serviceCategory)
        && (!item.piboCategory || norm(service.subApplicantType || service.piboCategory || service.applicantType) === norm(item.piboCategory))
        && (!item.servicesOffered || norm(service.servicesOffered) === norm(item.servicesOffered)));
      if (matches.length === 1) index = matches[0].i;
    }
    if (index < 0 || index >= services.length) return [];
    const id = serviceIdAt(lead, index);
    const assignment = (lead.assignments || []).find(a => id && a.assignedServiceId === id) || lead.assignments?.[index] || (services.length === 1 ? lead : {});
    if (!serviceClosedAt({ ...lead, serviceSelections: [services[index]], assignments: [assignment], closedBy: services.length === 1 ? lead.closedBy : null, closedByText: services.length === 1 ? lead.closedByText : '', closedAt: services.length === 1 ? lead.closedAt : null }, 0)) return [];
    if (assignment.poStatus && assignment.poStatus !== 'received') return [];
    if (/rejected|pending/i.test(assignment.poApprovalStatus || '')) return [];
    const orders = assignment.poYearRows?.length ? assignment.poYearRows : assignment.originalPoDetails ? [assignment.originalPoDetails] : [assignment];
    if (!orders.some(po => po.poNumber && (po.poFileUrl || po.compliancePoFile?.secureUrl || po.compliancePoFile?.url))) return [];
    return [{ ...item, sourceServiceIndex: index, sourceItemIndex, assignedServiceId: id || item.assignedServiceId }];
  });
}
module.exports = { eligibleItems };
