const LEAD_CODE = 'ATPL-LEAD-0057';
const COMPANY = 'ARCHIDPLY INDUSTRIES LIMITED';

async function restoreArchidplyLead(db, { apply = false } = {}) {
  // Raw collections intentionally include soft-deleted records.
  const leads = db.collection('leads');
  const approvals = db.collection('pendingapprovals');
  const matches = await leads.find({ leadCode: /^ATPL-LEAD\s*-\s*0*57$/i }).toArray();
  if (matches.length !== 1) throw new Error('Expected exactly one ATPL-LEAD-0057 record. No changes made.');
  const lead = matches[0];
  if (String(lead.company || '').trim().toUpperCase() !== COMPANY) throw new Error('Lead company mismatch. No changes made.');
  const leadId = String(lead._id);
  const links = { type: 'purchase_order', $or: [
    { 'payload.leadId': leadId }, { 'payload.leadId': lead._id },
    { sourceClientId: new RegExp(`^${leadId}:po:`) }
  ] };
  const archived = { ...links, deletedAt: { $ne: null } };
  const approvalCount = await approvals.countDocuments(archived);
  if (!apply) return { leadCode: LEAD_CODE, company: COMPANY, deleted: Boolean(lead.deletedAt), archivedApprovals: approvalCount, dryRun: true };
  if (lead.deletedAt) {
    await leads.updateOne({ _id: lead._id, deletedAt: lead.deletedAt }, { $set: { deletedAt: null, restoredAt: new Date() }, $unset: { deletedBy: '' } });
  }
  // Also finish approval recovery if a previous run restored only the lead.
  const result = await approvals.updateMany(archived, { $set: { deletedAt: null }, $unset: { deletedBy: '' } });
  const restored = await leads.findOne({ _id: lead._id });
  if (restored.deletedAt || await approvals.countDocuments(archived)) throw new Error('Restore verification failed. Retry the recovery.');
  return { leadCode: LEAD_CODE, company: COMPANY, restored: true, restoredApprovals: result.modifiedCount, dryRun: false };
}
module.exports = { restoreArchidplyLead };
