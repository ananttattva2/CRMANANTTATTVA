const text = value => String(value?._id || value?.id || value || '').trim();
function purchaseOrderLeadOwner(lead = {}, users = new Map()) {
  const [reference, savedName, savedEmail] = lead.generatedForUser || lead.generatedForName
    ? [lead.generatedForUser, lead.generatedForName, lead.generatedForEmail]
    : lead.createdOnBehalfOfUser || lead.createdOnBehalfOfName
      ? [lead.createdOnBehalfOfUser, lead.createdOnBehalfOfName, lead.createdOnBehalfOfEmail]
      : [lead.createdBy || lead.createdByCrmUserId, lead.createdByName || lead.importedCreatedBy, lead.createdByEmail];
  const id = text(reference);
  const user = users.get(id);
  return {
    id: id || null,
    name: String(user?.name || reference?.name || savedName || user?.email || reference?.email || savedEmail || 'Unassigned').trim()
  };
}
module.exports = { purchaseOrderLeadOwner };
