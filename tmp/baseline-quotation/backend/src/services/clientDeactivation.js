const Client = require('../models/Client');
const Lead = require('../models/Lead');
const Request = require('../models/ClientDeactivation');
const { userHasAnyRole } = require('../utils/userRoles');
const mongoose = require('mongoose');
const { clientAccessFilter } = require('../controllers/clientController');
const locked = (status) => ['MANAGER_PENDING', 'ADMIN_PENDING', 'INACTIVE'].includes(status);
const nameOf = (client) => client.data?.basic?.clientLegalName || client.data?.importMeta?.companyName || client.selectedLead?.company || '';
const companyKey = (client) => String(client.companyIdentity || client.selectedLead?.company || nameOf(client) || client.selectedLead?._id || client.selectedLead || client._id).trim().toLowerCase().replace(/\s+/g, ' ');
async function resolveClient(id, user) {
  const client = await Client.findOne({ $and: [{ _id: id }, await clientAccessFilter(user)] }).populate('selectedLead', 'company').lean();
  return client;
}
async function request(req, res) {
  try {
    const reason = String(req.body.reason || '').trim();
    if (!reason || reason.length > 4000) return res.status(400).json({ error: 'Enter a reason between 1 and 4000 characters.' });
    const client = await resolveClient(req.params.id, req.user);
    if (!client) return res.status(404).json({ error: 'Client not found or unavailable.' });
    const managerId = req.user.managerId;
    if (!managerId || String(managerId) === String(req.user._id)) return res.status(400).json({ error: 'Assign a reporting manager before requesting deactivation.' });
    const key = companyKey(client);
    const companyClients = await Client.find({}).select('_id selectedLead companyIdentity data.basic.clientLegalName data.importMeta.companyName').populate('selectedLead', 'company').lean();
    const clientIds = companyClients.filter((entry) => companyKey(entry) === key).map((entry) => entry._id);
    const event = { action: 'REQUESTED', reason, by: req.user._id, at: new Date() };
    const existing = await Request.findOne({ companyKey: key }).lean();
    if (existing && locked(existing.status)) return res.status(409).json({ error: 'This client is already inactive or awaiting approval.' });
    let row;
    if (existing) row = await Request.findOneAndUpdate({ _id: existing._id, status: 'REJECTED' }, { $set: { status: 'MANAGER_PENDING', clientIds, requestedBy: req.user._id, managerId }, $push: { history: event } }, { new: true });
    else row = await Request.create({ companyKey: key, clientName: nameOf(client), clientIds, status: 'MANAGER_PENDING', requestedBy: req.user._id, managerId, history: [event] });
    if (!row) return res.status(409).json({ error: 'Request changed. Refresh and retry.' });
    return res.json({ request: row });
  } catch (error) { return res.status(error.code === 11000 ? 409 : 500).json({ error: error.code === 11000 ? 'A deactivation request already exists.' : 'Unable to request deactivation.' }); }
}
async function list(req, res) {
  try {
    const admin = userHasAnyRole(req.user, ['admin', 'superadmin']);
    const filter = admin ? {} : { $or: [{ requestedBy: req.user._id }, ...(userHasAnyRole(req.user, ['manager']) ? [{ managerId: req.user._id }] : [])] };
    const rows = await Request.find(filter).populate('requestedBy', 'name email').populate('history.by', 'name email').sort({ updatedAt: -1 }).lean();
    return res.json({ requests: rows.map((row) => ({ ...row, canDecide: String(row.requestedBy?._id) !== String(req.user._id) && ((row.status === 'MANAGER_PENDING' && userHasAnyRole(req.user, ['manager']) && String(row.managerId) === String(req.user._id)) || (row.status === 'ADMIN_PENDING' && admin)) })) });
  } catch { return res.status(500).json({ error: 'Unable to load deactivation requests.' }); }
}
async function statuses(req, res) {
  try {
    const clients = await Client.find(await clientAccessFilter(req.user)).select('_id').lean();
    const rows = await Request.find({ clientIds: { $in: clients.map((client) => client._id) } }).select('clientIds status').lean();
    return res.json({ statuses: rows });
  } catch { return res.status(500).json({ error: 'Unable to load client statuses.' }); }
}
async function decide(req, res) {
  try {
    const { decision } = req.body;
    const reason = String(req.body.reason || '').trim();
    if (!['APPROVE', 'REJECT'].includes(decision) || !reason || reason.length > 4000) return res.status(400).json({ error: 'Select a decision and enter a reason (maximum 4000 characters).' });
    const row = await Request.findById(req.params.requestId).lean();
    if (!row) return res.status(404).json({ error: 'Request not found.' });
    const manager = row.status === 'MANAGER_PENDING' && userHasAnyRole(req.user, ['manager']) && String(row.managerId) === String(req.user._id);
    const admin = row.status === 'ADMIN_PENDING' && userHasAnyRole(req.user, ['admin', 'superadmin']);
    if ((!manager && !admin) || String(row.requestedBy) === String(req.user._id)) return res.status(403).json({ error: 'This approval stage is not assigned to you.' });
    const status = decision === 'REJECT' ? 'REJECTED' : manager ? 'ADMIN_PENDING' : 'INACTIVE';
    const updated = await Request.findOneAndUpdate({ _id: row._id, status: row.status }, { $set: { status }, $push: { history: { action: `${manager ? 'MANAGER' : 'ADMIN'}_${decision}`, reason, by: req.user._id, at: new Date() } } }, { new: true });
    if (!updated) return res.status(409).json({ error: 'Request was already reviewed. Refresh the page.' });
    return res.json({ request: updated });
  } catch { return res.status(500).json({ error: 'Unable to save decision.' }); }
}
async function guard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.includes('/deactivation')) return next();
  if (req.clientDeactivationChecked) return next();
  try {
    if (req.path.includes('approve-all')) {
      req.clientDeactivationLocks = await Request.find({ status: { $in: ['MANAGER_PENDING', 'ADMIN_PENDING', 'INACTIVE'] } }).select('clientIds clientName').lean();
    }
    const id = [req.params.id, req.params.clientId, req.body?.recordId, req.body?.clientId, req.body?.clientMasterId, req.body?._id, req.body?.id, req.body?.data?.clientMasterId].find((value) => value && mongoose.isValidObjectId(value));
    const candidates = id ? [await Client.findById(id).populate('selectedLead', 'company').lean()] : (Array.isArray(req.body?.clients) ? req.body.clients : [req.body?.clientData ? { data: req.body.clientData } : req.body]);
    if (!id && req.params.id && !['bulk', 'years', 'onboarding', 'pending-approvals'].includes(req.params.id)) {
      candidates.push(await Client.findOne({ $or: [{ 'data.importMeta.uniqueId': req.params.id }, { 'data.basic.clientLegalName': req.params.id }, { 'data.basic.tradeName': req.params.id }] }).populate('selectedLead', 'company').lean());
    }
    if (Array.isArray(req.body?.rows)) {
      const uniqueIds = req.body.rows.map((row) => row.companyUniqueId).filter(Boolean);
      if (uniqueIds.length) candidates.push(...await Client.find({ 'data.importMeta.uniqueId': { $in: uniqueIds } }).populate('selectedLead', 'company').lean());
    }
    for (let client of candidates.filter(Boolean)) {
      if (client.selectedLead && !client.selectedLead.company) {
        const leadId = client.selectedLead?._id || client.selectedLead;
        if (mongoose.isValidObjectId(leadId)) client = { ...client, selectedLead: await Lead.findById(leadId).select('company').lean() };
      }
      if (!id && !nameOf(client) && !client.companyIdentity && !client.selectedLead && !client._id) continue;
      const row = await Request.findOne({ $or: [{ companyKey: companyKey(client) }, { clientIds: client._id }], status: { $in: ['MANAGER_PENDING', 'ADMIN_PENDING', 'INACTIVE'] } }).lean();
      if (row) return res.status(423).json({ error: row.status === 'INACTIVE' ? 'This client is inactive and cannot be edited.' : 'Client editing is locked while deactivation approval is pending.' });
    }
    req.clientDeactivationChecked = true;
    next();
  } catch { return res.status(500).json({ error: 'Unable to verify client editing status.' }); }
}
module.exports = { request, list, statuses, decide, guard, locked, companyKey };
