const COMPANY_PATTERNS = [
  /^SWISS\s+PAREN(?:TERALS|TALS)\s+(?:LTD\.?|LIMITED)$/i,
  /^CCL\s+FOOD\s+(?:AND|&)\s+BEVERAGES\s+PVT\.?\s+LTD\.?$/i,
  /^ASHISH\s+PLASTICS$/i, /^ANAVEN\s+LLP$/i,
  /^TENNECO\s+AUTOMOTIVE\s+INDIA?\s+PVT\.?\s+LTD\.?$/i,
  /^SOLTEX\s+PETRO\s+PRODUCTS\s+LTD\.?$/i,
  /^PERFECT\s+CARBOU?YS\s+PVT\.?\s+LTD\.?$/i
];
function matchesCompany(value) { return COMPANY_PATTERNS.some(pattern => pattern.test(String(value || '').trim())); }
async function correctRequestedClientCreators({ User, Lead, Client, Approval, connection, backup }) {
  const users = await User.find({ name: /^KRISHNA\s+YADAV$/i, isActive: { $ne: false } }).lean();
  if (users.length !== 1) throw new Error('A unique active KRISHNA Yadav user is required.');
  const owner = users[0], session = await connection.startSession();
  let result, snapshotIds = [];
  try {
    await session.withTransaction(async () => {
      const leads = await Lead.find({ company: { $in: COMPANY_PATTERNS } }).session(session).lean();
      const clients = await Client.find({ $or: [{ 'data.basic.clientLegalName': { $in: COMPANY_PATTERNS } }, { 'data.basic.tradeName': { $in: COMPANY_PATTERNS } }] }).session(session).lean();
      const ids = clients.map(row => String(row._id));
      const approvals = await Approval.find({ type: 'client', $or: [{ sourceClientId: { $in: ids } }, { clientName: { $in: COMPANY_PATTERNS } }] }).session(session).lean();
      snapshotIds = [...leads.map(row => `Lead:${row._id}`), ...clients.map(row => `Client:${row._id}`), ...approvals.map(row => `PendingApproval:${row._id}`)];
      await backup({ leads, clients, approvals });
      const label = owner.name, email = String(owner.email || '').toLowerCase();
      for (const lead of leads) await Lead.updateOne({ _id: lead._id }, { $set: { createdBy: owner._id, createdByName: label, createdByEmail: email, createdByCrmUserId: owner.crmUserId || String(owner._id), importedCreatedBy: label }, $push: { creatorChangeHistory: { previousCreatedBy: lead.createdBy, previousName: lead.createdByName || lead.importedCreatedBy, createdBy: owner._id, name: label, at: new Date(), reason: 'User-requested Created By correction for listed companies' } } }, { session });
      for (const client of clients) await Client.updateOne({ _id: client._id }, { $set: { createdBy: owner._id, 'data.importMeta.createdBy': label, 'data.importMeta.createdByEmail': email } }, { session });
      for (const approval of approvals) await Approval.updateOne({ _id: approval._id }, { $set: { createdByName: label, 'payload.createdBy': label, 'payload.userName': label } }, { session });
      result = { createdBy: label, leads: leads.length, clients: clients.length, approvals: approvals.length, companies: [...new Set([...leads.map(row => row.company), ...clients.map(row => row.data?.basic?.clientLegalName)].filter(Boolean))] };
    });
    if (snapshotIds.length) await connection.collection('crm_compact_read_snapshots').deleteMany({ _id: { $in: snapshotIds } });
    return result;
  } finally { await session.endSession(); }
}
module.exports = { COMPANY_PATTERNS, matchesCompany, correctRequestedClientCreators };
