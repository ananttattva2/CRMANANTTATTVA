const { noOwnerWorkspaceFilter, eligibleForNoOwner, previousOwner } = require('./leadOwnershipAndEmailWorkflow');
const id = value => String(value?._id || value?.id || value || '');
function isSharedLead(lead, now = Date.now()) { return Boolean(lead.noOwner?.active || eligibleForNoOwner(lead, now)); }
function prepareSharedLeadClaim(lead, before, data, actor, now = new Date()) {
  if (!actor?._id) throw Object.assign(new Error('Sign in before updating a shared lead.'), { status: 401 });
  const name = actor.name || actor.email || 'CRM User';
  const patch = {
    noOwner: { ...(before.noOwner || {}), active: false, previousOwner: before.noOwner?.previousOwner || previousOwner(before), reassignedAt: now },
    createdBy: actor._id, createdByName: name, createdByEmail: actor.email || '', createdByCrmUserId: actor.crmUserId || '', importedCreatedBy: name,
    generatedForUser: actor._id, generatedForName: name, generatedForEmail: actor.email || '', creationMode: 'self',
    createdOnBehalfOfUser: actor._id, createdOnBehalfOfName: name, createdOnBehalfOfEmail: actor.email || '',
    secondaryCreatedBy: null, secondaryCreatedByName: '', secondaryCreatedByEmail: '', secondaryCreatedByCrmUserId: ''
  };
  for (const field of ['assignedTo','assignedStaff']) {
    if (!data[field] || id(data[field]) === id(before[field])) Object.assign(patch, { [field]: null, [field+'Text']: '', [field+'Email']: '' });
  }
  patch.assignments = (data.assignments || before.assignments || []).map((row,index) => {
    const next = { ...row }, previous = before.assignments?.[index] || {};
    for (const field of ['assignedTo','assignedStaff']) if (!row[field] || id(row[field]) === id(previous[field])) Object.assign(next, { [field]: null, [field+'Text']: '', [field+'Email']: '', [field+'CrmUserId']: '' });
    return next;
  });
  patch.serviceSelections = (data.serviceSelections || before.serviceSelections || []).map(row => ({ ...row, createdByName: name, createdByEmail: actor.email || '', createdByCrmUserId: actor.crmUserId || id(actor._id) }));
  // Mongoose merges $where into the save's atomic update filter. The lead edit
  // and ownership transfer therefore succeed together, for only one claimant.
  lead.$where = { ...noOwnerWorkspaceFilter(now.getTime()), updatedAt: before.updatedAt ?? null };
  return { ...data, ...patch };
}
module.exports = { isSharedLead, prepareSharedLeadClaim };
