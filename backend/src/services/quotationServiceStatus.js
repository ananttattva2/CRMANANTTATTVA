const mongoose = require('mongoose');
const Lead = require('../models/Lead');

const identity = value => String(value || '').trim();
const serviceId = row => identity(row?.assignedServiceId || row?.serviceAssignmentId || row?.assignmentId);
const normalized = value => identity(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const isClosed = row => Boolean(row?.closedAt || row?.closedBy || row?.closedByText || row?.closedByEmail
  || row?.permanentClosedAt || normalized(row?.poStatus) === 'permanentlyclosed' || normalized(row?.status) === 'closed');

function serviceLabels(row) {
  return [
    row.servicesOffered || row.applicableService,
    row.eprCategory || row.serviceCategory,
    row.subApplicantType || row.piboCategory || row.applicantType,
    row.servicesForYear || row.firstAnnualReturnYearApplicable || row.financialYear
  ].map(normalized);
}

function compareLabels(item, service) {
  const labels = serviceLabels(service);
  const pairs = serviceLabels(item).map((label, index) => [label, labels[index]]);
  const comparable = pairs.filter(([left, right]) => left && right);
  if (!comparable.length) return null;
  return comparable.every(([left, right]) => left === right);
}

function itemClosureStates(quotation, lead) {
  const items = quotation.items || [];
  if (!lead) return items.map(() => quotation.serviceState === 'closed' ? 'closed' : 'open');

  const assignments = lead.assignments || [];
  const services = lead.serviceSelections?.length ? lead.serviceSelections : assignments.length > 1 ? assignments : [lead];
  const singleService = services.length === 1 && assignments.length <= 1;
  const assignmentById = new Map();
  for (const assignment of assignments) {
    const id = serviceId(assignment);
    if (id && (!assignmentById.has(id) || !isClosed(assignment))) assignmentById.set(id, assignment);
  }
  function assignmentAt(position, id) {
    const positional = assignments[position];
    return assignmentById.get(id) || (!id || !serviceId(positional) || serviceId(positional) === id ? positional : undefined);
  }
  const matchedAssignments = new Set();
  const servicesClosed = services.every((service, index) => {
    const assignment = assignmentAt(index, serviceId(service));
    if (assignment) matchedAssignments.add(assignment);
    return isClosed(service) || isClosed(assignment);
  });
  // Historical quotes may retain an item ID or year that no longer matches the
  // lead's service rows. Only apply lead-wide closure when every service is closed.
  if ((singleService && isClosed(lead)) || (servicesClosed
    && assignments.every(assignment => matchedAssignments.has(assignment) || isClosed(assignment)))) {
    return items.map(() => 'closed');
  }

  return items.map(item => {
    const id = serviceId(item);
    const byAssignmentId = assignmentById.get(id);
    const index = byAssignmentId ? assignments.indexOf(byAssignmentId) : item.sourceServiceIndex;
    const indexedService = services[index];
    const indexedAssignment = assignments[index];
    const byServiceId = id ? services.findIndex(row => serviceId(row) === id) : -1;
    let serviceIndex = byServiceId;

    if (serviceIndex < 0 && (indexedService || indexedAssignment)
      && (!id || !serviceId(indexedService))
      && (!id || !serviceId(indexedAssignment) || serviceId(indexedAssignment) === id)
      && (byAssignmentId || !indexedService || compareLabels(item, indexedService) !== false)) {
      serviceIndex = index;
    }
    if (serviceIndex < 0 && !id) {
      const candidates = services.flatMap((service, position) => compareLabels(item, service) === true ? [position] : []);
      if (candidates.length === 1) [serviceIndex] = candidates;
    }

    const service = services[serviceIndex];
    const matchedId = id || serviceId(service);
    const assignment = assignmentAt(serviceIndex, matchedId);
    // The root row often carries the first closure on a multi-service lead.
    const serviceClosed = service !== lead && isClosed(service);
    return serviceClosed || isClosed(assignment) ? 'closed' : 'open';
  });
}

async function attachQuotationServiceStatus(quotations) {
  const references = row => [row.leadRef, row.leadId, row.leadCode, row.businessLeadCode].map(identity).filter(Boolean);
  const identifiers = [...new Set(quotations.flatMap(references))];
  const ids = identifiers.filter(value => mongoose.isObjectIdOrHexString(value));
  const leads = identifiers.length ? await Lead.find({ $or: [
    { _id: { $in: ids } },
    ...['leadCode', 'sourceLeadId', 'externalLeadId'].map(field => ({ [field]: { $in: identifiers } }))
  ] }).select('leadCode sourceLeadId externalLeadId assignedServiceId status closedAt closedBy closedByText closedByEmail permanentClosedAt poStatus servicesOffered eprCategory subApplicantType applicantType firstAnnualReturnYearApplicable serviceSelections assignments.assignedServiceId assignments.serviceAssignmentId assignments.assignmentId assignments.status assignments.poStatus assignments.closedAt assignments.closedBy assignments.closedByText assignments.closedByEmail assignments.permanentClosedAt').lean() : [];

  const byId = new Map(leads.map(lead => [String(lead._id), lead]));
  const byCode = new Map(leads.filter(lead => lead.leadCode).map(lead => [lead.leadCode, lead]));
  const byLegacyId = new Map();
  for (const lead of leads) {
    for (const key of [lead.sourceLeadId, lead.externalLeadId].filter(Boolean)) {
      if (!byLegacyId.has(key)) byLegacyId.set(key, lead);
      else if (byLegacyId.get(key) !== lead) byLegacyId.set(key, null);
    }
  }
  return quotations.map(row => {
    const keys = references(row);
    const lead = [byId, byCode, byLegacyId].map(index => keys.map(key => index.get(key)).find(Boolean)).find(Boolean);
    return { ...row, linkedLeadId: lead ? String(lead._id) : null, itemClosureStates: itemClosureStates(row, lead) };
  });
}

module.exports = { attachQuotationServiceStatus, itemClosureStates };
