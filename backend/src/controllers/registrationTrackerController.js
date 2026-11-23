const Client = require('../models/Client');
const Tracker = require('../models/RegistrationTracker');
const { resolveServiceHistory } = require('../services/annualReturnPoResolver');
const { isRegistration } = require('../../../shared/serviceYearAccess.cjs');
async function context(req) {
  const access = await require('./clientController').clientAccessFilter(req.user);
  const client = await Client.findOne({ $and: [{ _id: req.params.id }, access] }).lean();
  if (!client) throw Object.assign(new Error('Client not found or not accessible.'), { status: 404 });
  const input = req.method === 'GET' ? req.query : req.body;
  const rows = await resolveServiceHistory({ clientMaster: client });
  const row = rows.find(row => row.assignedServiceId === input.assignedServiceId && row.number === input.poNumber && (row.registrationYear || '') === (input.registrationYear || '') && isRegistration(row.service));
  if (!row) throw Object.assign(new Error('A closed Registration or New Registration service is required.'), { status: 403 });
  return { client: client._id, assignedServiceId: row.assignedServiceId, poNumber: row.number, registrationYear: row.registrationYear || '' };
}
function validate(body) {
  const update = {};
  for (const key of ['dataReceived', 'complianceCheck', 'registrationCompleted']) {
    if (!['yes', 'no'].includes(body[key])) throw Object.assign(new Error('Select Yes or No for all three stages.'), { status: 400 });
    update[key] = body[key];
  }
  const proof = body.proof;
  if (body.registrationCompleted === 'yes' && (!proof || !/^https?:\/\//i.test(String(proof.secureUrl || proof.url || '')))) {
    throw Object.assign(new Error('Upload completion proof before marking Registration Completed as Yes.'), { status: 400 });
  }
  update.proof = proof ? { name: String(proof.name || '').slice(0, 250), secureUrl: String(proof.secureUrl || proof.url || ''), url: String(proof.secureUrl || proof.url || '') } : null;
  return update;
}
exports.get = async (req, res, next) => {
  try { const filter = await context(req); return res.json({ ok: true, tracker: await Tracker.findOne(filter).lean() || { dataReceived: 'no', complianceCheck: 'no', registrationCompleted: 'no', proof: null } }); }
  catch (error) { next(error); }
};
exports.save = async (req, res, next) => {
  try {
    const update = validate(req.body), filter = await context(req);
    const tracker = await Tracker.findOneAndUpdate(filter, { $set: { ...update, updatedBy: req.user._id } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    return res.json({ ok: true, tracker });
  } catch (error) { next(error); }
};
exports.__test = { validate };
