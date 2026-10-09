const text = value => String(value || '').trim()
export function clientLeadOwner(client = {}, users = []) {
  const lead = client.selectedLead && typeof client.selectedLead === 'object'
    ? client.selectedLead : client.data?.selectedLeadSnapshot || {}
  const designated = lead.generatedForUser || lead.generatedForName
    ? [lead.generatedForUser, lead.generatedForName, lead.generatedForEmail]
    : lead.createdOnBehalfOfUser || lead.createdOnBehalfOfName
      ? [lead.createdOnBehalfOfUser, lead.createdOnBehalfOfName, lead.createdOnBehalfOfEmail]
      : [lead.createdBy || lead.createdByCrmUserId, lead.createdByName || lead.importedCreatedBy, lead.createdByEmail]
  const [reference, savedName, email] = designated
  const id = text(reference?._id || reference?.id || reference)
  const user = users.find(u => [u._id, u.id, u.crmUserId, u.userId].some(value => id && text(value) === id))
  // Client Master creator and execution assignee are separate from lead ownership.
  return text(user?.name || reference?.name || savedName || user?.email || reference?.email || email) || '-'
}
