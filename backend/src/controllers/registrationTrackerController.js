const Client = require('../models/Client');
const Tracker = require('../models/RegistrationTracker');
const User = require('../models/User');
const Team = require('../models/Team');
const { userHasAnyRole } = require('../utils/userRoles');
const { resolveServiceHistory } = require('../services/annualReturnPoResolver');
const { isRegistration } = require('../../../shared/serviceYearAccess.cjs');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const proofOf = proof => proof && /^https?:\/\//i.test(String(proof.secureUrl || proof.url || '')) ? { name: String(proof.name || 'View proof').slice(0, 250), secureUrl: String(proof.secureUrl || proof.url), url: String(proof.secureUrl || proof.url) } : null;
async function context(req) {
  const access = await require('./clientController').clientAccessFilter(req.user);
  const client = await Client.findOne({ $and: [{ _id: req.params.id }, access] }).lean();
  if (!client) fail('Client not found or not accessible.', 404);
  const input = req.method === 'GET' ? req.query : req.body;
  const rows = await resolveServiceHistory({ clientMaster: client });
  const row = rows.find(row => row.assignedServiceId === input.assignedServiceId && row.number === input.poNumber && (row.registrationYear || '') === (input.registrationYear || '') && isRegistration(row.service));
  if (!row) fail('A closed Registration or New Registration service is required.', 403);
  return { client, filter: { client: client._id, assignedServiceId: row.assignedServiceId, poNumber: row.number, registrationYear: row.registrationYear || '' } };
}
function validate(body, previous = {}) {
  const update = {};
  for (const key of ['dataExplained', 'dataReceived', 'registrationCompleted']) {
    if (!['yes', 'no'].includes(body[key])) fail('Select Yes or No for all three stages.');
    update[key] = body[key];
  }
  for (const [stage, field, label] of [['dataExplained', 'explainedProof', 'Data Explained'], ['dataReceived', 'receivedProof', 'Data Received'], ['registrationCompleted', 'proof', 'Registration Completed']]) {
    update[field] = proofOf(body[field]);
    if (update[stage] === 'yes' && !update[field]) fail(`Upload proof for ${label} before selecting Yes.`);
  }
  if (update.dataReceived === 'yes' && update.dataExplained !== 'yes') fail('Complete Data Explained first.');
  if (update.registrationCompleted === 'yes' && (previous.managerStatus !== 'APPROVED' || previous.complianceStatus !== 'APPROVED' || update.dataReceived !== 'yes' || update.dataExplained !== 'yes')) fail('Manager and Compliance approval are required before Registration Completed.');
  return update;
}
async function managerFor(actor) {
  const fresh = await User.findById(actor._id).select('managerId').lean();
  const managerId = fresh?.managerId || actor.managerId;
  if (managerId) return User.findById(managerId).select('name email isActive').lean();
  const team = await Team.findOne({ members: actor._id }).populate('manager', 'name email isActive').lean();
  return team?.manager || null;
}
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function notify(tracker, client, event) {
  if (tracker.notifications?.[event]) return { sent: true };
  const manager = tracker.manager ? await User.findById(tracker.manager).select('email name isActive').lean() : null;
  const recipients = event === 'compliance' ? await User.find({ isActive: { $ne: false }, $or: [{ role: 'compliance' }, { roles: 'compliance' }] }).select('email').lean() : [manager];
  const emails = [...new Set(recipients.filter(user => user?.isActive !== false && user?.email).map(user => user.email))];
  if (!emails.length) return { sent: false, warning: 'Saved, but no active email recipient was found.' };
  const name = client.data?.basic?.clientLegalName || client.data?.basic?.tradeName || 'Client';
  const label = event === 'completed' ? 'Registration Completed' : event === 'compliance' ? 'Registration Compliance Review' : 'Registration Data Ready for Manager Review';
  const base = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://crmananttattva.com';
  const link = `${base.replace(/\/$/, '')}/compliance/ar?tab=registration${event === 'completed' ? '&registrationStatus=completed' : ''}`;
  try {
    const result = await require('../utils/mailer').sendMail(emails, `${label} | ${name}`, `<div style="font-family:Arial;background:#f0fdfa;padding:24px"><div style="max-width:640px;background:white;border:1px solid #cbd5e1;border-radius:16px;margin:auto;overflow:hidden"><h2 style="margin:0;background:#087a70;color:white;padding:24px">${escape(label)}</h2><div style="padding:24px"><h3>${escape(name)}</h3><p>PO: <b>${escape(tracker.poNumber)}</b> · Registration Year: <b>${escape(tracker.registrationYear)}</b></p><p>Data Explained: Yes · Data Received: Yes</p><p>${event === 'completed' ? 'Completion proof has been uploaded by the assigned user.' : 'Review the uploaded proofs and record your decision.'}</p><a href="${escape(link)}" style="display:inline-block;background:#087a70;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">Open Registration Review</a></div></div></div>`, { branded: false });
    if (result?.summary?.rejected?.length) throw Error('Email recipient rejected');
    await Tracker.updateOne({ _id: tracker._id }, { $set: { [`notifications.${event}`]: new Date() } });
    return { sent: true };
  } catch (error) { console.error('[registration-email]', error.message); return { sent: false, warning: 'Saved successfully. Email delivery failed; save again to retry the notification.' }; }
}
exports.get = async (req, res, next) => {
  try { const { filter } = await context(req); return res.json({ ok: true, tracker: await Tracker.findOne(filter).lean() || { dataExplained: 'no', dataReceived: 'no', registrationCompleted: 'no', managerStatus: 'PENDING', complianceStatus: 'NOT_READY' } }); } catch (error) { next(error); }
};
exports.save = async (req, res, next) => {
  try {
    const { client, filter } = await context(req);
    const previous = await Tracker.findOne(filter).lean() || {};
    const update = validate(req.body, previous);
    if (previous.registrationCompleted === 'yes' && (update.registrationCompleted !== 'yes' || JSON.stringify(update.proof) !== JSON.stringify(previous.proof))) fail('Completed registrations are read-only.', 409);
    const dataFields = ['dataExplained', 'dataReceived', 'explainedProof', 'receivedProof'];
    const changed = dataFields.some(key => JSON.stringify(update[key] ?? null) !== JSON.stringify(previous[key] ?? null));
    if (previous.submittedAt && changed && ![previous.managerStatus, previous.complianceStatus].includes('REJECTED')) fail('Submitted data is locked while under review or approved.', 409);
    let submit = false;
    if (update.dataExplained === 'yes' && update.dataReceived === 'yes' && (!previous.submittedAt || changed)) {
      const manager = await managerFor(req.user);
      if (!manager?._id || manager.isActive === false) fail('An active Manager must be assigned to your account before submitting registration data.');
      Object.assign(update, { manager: manager._id, submittedBy: req.user._id, submittedAt: new Date(), managerStatus: 'PENDING', complianceStatus: 'NOT_READY', notifications: {} });
      submit = true;
    }
    const tracker = await Tracker.findOneAndUpdate(filter, { $set: { ...update, updatedBy: req.user._id }, $push: { history: { action: submit ? 'SUBMITTED' : update.registrationCompleted === 'yes' ? 'COMPLETED' : 'SAVED', by: req.user._id, at: new Date() } } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    const notification = tracker.registrationCompleted === 'yes' ? await notify(tracker, client, 'completed') : tracker.submittedAt && tracker.managerStatus === 'PENDING' ? await notify(tracker, client, 'submitted') : null;
    return res.json({ ok: true, tracker, notification });
  } catch (error) { next(error); }
};
exports.list = async (req, res, next) => {
  try {
    if (!userHasAnyRole(req.user, ['manager', 'compliance', 'admin', 'superadmin'])) fail('Registration review access required.', 403);
    const elevated = userHasAnyRole(req.user, ['compliance', 'admin', 'superadmin']);
    const rows = await Tracker.find({ submittedAt: { $exists: true }, ...(elevated ? {} : { manager: req.user._id }) }).populate('client', 'data.basic').populate('submittedBy', 'name email').populate('manager', 'name').sort({ updatedAt: -1 }).lean();
    return res.json({ ok: true, rows });
  } catch (error) { next(error); }
};
exports.decide = async (req, res, next) => {
  try {
    const tracker = await Tracker.findById(req.params.trackerId).lean();
    if (tracker && req.params.id && String(tracker.client) !== String(req.params.id)) fail('Tracker does not belong to this client.', 404);
    if (!tracker?.submittedAt) fail('Submitted tracker not found.', 404);
    const { stage, decision, remarks } = req.body;
    if (!['manager', 'compliance'].includes(stage) || !['APPROVED', 'REJECTED'].includes(decision) || !String(remarks || '').trim()) fail('Select a decision and enter review remarks.');
    const canManager = String(tracker.manager) === String(req.user._id) || userHasAnyRole(req.user, ['admin', 'superadmin']);
    const canCompliance = userHasAnyRole(req.user, ['compliance', 'admin', 'superadmin']);
    if (String(tracker.submittedBy) === String(req.user._id)) fail('You cannot review your own registration submission.', 403);
    if ((stage === 'manager' && !canManager) || (stage === 'compliance' && !canCompliance)) fail('You cannot review this stage.', 403);
    const expected = stage === 'manager' ? { managerStatus: 'PENDING' } : { managerStatus: 'APPROVED', complianceStatus: 'PENDING' };
    const update = stage === 'manager' ? { managerStatus: decision, complianceStatus: decision === 'APPROVED' ? 'PENDING' : 'NOT_READY' } : { complianceStatus: decision };
    const saved = await Tracker.findOneAndUpdate({ _id: tracker._id, ...expected, registrationCompleted: { $ne: 'yes' } }, { $set: update, $push: { history: { stage, decision, remarks: String(remarks).trim().slice(0, 3000), by: req.user._id, byName: req.user.name, at: new Date() } } }, { new: true });
    if (!saved) fail('This stage has already changed. Refresh before reviewing.', 409);
    const client = await Client.findById(tracker.client).select('data.basic').lean();
    const notification = stage === 'manager' && decision === 'APPROVED' ? await notify(saved, client || {}, 'compliance') : null;
    return res.json({ ok: true, tracker: saved, notification });
  } catch (error) { next(error); }
};
exports.__test = { validate, proofOf };
