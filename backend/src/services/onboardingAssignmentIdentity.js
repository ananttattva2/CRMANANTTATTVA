const Lead = require('../models/Lead');
const id = value => String(value?._id || value?.id || value || '').trim();
const serviceId = value => id(value?.assignedServiceId || value?.serviceAssignmentId || value?.data?.selectedLeadSnapshot?.assignedServiceId);

function matchingAssignmentIndexes(client, lead) {
  const assignments = lead?.assignments || [];
  const selected = serviceId(client);
  if (selected) return assignments.flatMap((assignment, index) => {
    const assigned = serviceId(assignment) || serviceId(lead.serviceSelections?.[index]);
    return assigned === selected ? [index] : [];
  });
  return assignments.length === 1 ? [0] : [];
}

async function clientAssignmentFilter(client, identity) {
  if (!identity.leadKey) return null;
  if (!serviceId(client)) return identity.ownerId ? { leadKey: identity.leadKey, staffId: identity.ownerId } : null;
  const lead = await Lead.findById(identity.leadKey).select('assignments.assignedServiceId assignments.serviceAssignmentId serviceSelections.assignedServiceId serviceSelections.serviceAssignmentId').lean();
  const indexes = matchingAssignmentIndexes(client, lead);
  return indexes.length ? { leadKey: identity.leadKey, rowIndex: { $in: indexes } }
    : identity.ownerId ? { leadKey: identity.leadKey, staffId: identity.ownerId } : null;
}

module.exports = { serviceId, matchingAssignmentIndexes, clientAssignmentFilter };
