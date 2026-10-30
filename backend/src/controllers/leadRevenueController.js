const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const TemporaryLead = require('../models/TemporaryLead');
const Revenue = require('../models/LeadRevenue');
const { leadAccessFilter } = require('./leadController');
const { temporaryLeadAccessFilter } = require('./temporaryLeadController');
const { amountPaise, serviceRows, groupsFrom, hotClosed, purchaseOrders, serviceDetails } = require('../services/leadRevenue');
const { userHasAnyRole } = require('../utils/userRoles');

function pipelineOwner(lead, kind) {
  const currentOwner = kind === 'hot' ? lead.generatedForUser : lead.createdBy;
  return currentOwner?.name || currentOwner?.email
    || (kind === 'hot' ? lead.generatedForName : '')
    || lead.importedCreatedBy || lead.createdByName || 'Unassigned';
}

async function context(req) {
  const kind = req.params.kind;
  if (!['hot', 'cold'].includes(kind) || !mongoose.isValidObjectId(req.params.id)) return null;
  const model = kind === 'hot' ? Lead : TemporaryLead;
  const access = await (kind === 'hot' ? leadAccessFilter(req.user) : temporaryLeadAccessFilter(req.user));
  const lead = await model.findOne({ $and: [{ _id: req.params.id }, access] }).lean();
  if (!lead) return null;
  const query = [{ leadKind: kind, leadId: lead._id }];
  if (kind === 'hot') {
    const origin = await TemporaryLead.findOne({ convertedLead: lead._id, status: 'CONVERTED' }).select('_id').lean();
    if (origin) query.push({ leadKind: 'cold', leadId: origin._id });
  }
  const entries = await Revenue.find({ $or: query }).sort({ createdAt: 1 }).lean();
  const used = new Set(entries.filter(e => e.leadKind === kind).flatMap(e => e.serviceKeys));
  const identities = [req.user._id, req.user.crmUserId].filter(Boolean).map(String);
  const admin = userHasAnyRole(req.user, ['admin', 'superadmin']);
  const eligible = serviceRows(lead, kind).filter(s => !used.has(s.key) && (admin || identities.includes(s.owner)));
  return { kind, lead, entries, eligible, groups: groupsFrom(entries) };
}
exports.get = async (req, res, next) => {
  try {
    const c = await context(req);
    if (!c) return res.status(404).json({ error: 'Lead not found or not accessible.' });
    return res.json({ ok: true, groups: c.groups, canEditSaved: userHasAnyRole(req.user, ['admin', 'superadmin']), eligibleServices: c.eligible, serviceKeys: serviceRows(c.lead, c.kind).map(s => s.key), locked: c.kind === 'cold' && (c.lead.status === 'CONVERTED' || Boolean(c.lead.pipelineClosedAt)) });
  } catch (error) { next(error); }
};
exports.add = async (req, res, next) => {
  try {
    const c = await context(req);
    if (!c) return res.status(404).json({ error: 'Lead not found or not accessible.' });
    if (c.kind === 'cold' && (c.lead.status === 'CONVERTED' || c.lead.pipelineClosedAt)) return res.status(409).json({ error: 'This cold lead is closed or converted. Use its Hot Lead after conversion.' });
    const requestId = String(req.body.requestId || '');
    if (!/^[\da-f-]{36}$/i.test(requestId)) return res.status(400).json({ error: 'A valid revenue request ID is required.' });
    let paise;
    try { paise = amountPaise(req.body.amount); } catch (e) { return res.status(400).json({ error: e.message }); }
    const prior = await Revenue.findOne({ requestId }).lean();
    if (prior) {
      if (String(prior.leadId) !== String(c.lead._id) || prior.leadKind !== c.kind || String(prior.createdBy) !== String(req.user._id) || prior.amountPaise !== paise) return res.status(409).json({ error: 'Revenue request ID already used.' });
      return res.json({ ok: true, alreadySaved: true });
    }
    const requested = [...new Set(Array.isArray(req.body.serviceKeys) ? req.body.serviceKeys.map(String) : [])];
    const services = c.eligible.filter(s => requested.includes(s.key));
    if (!services.length || services.length !== requested.length) return res.status(409).json({ error: 'Select unpriced services that you created. Saved revenue cannot be edited. Refresh and try again.' });
    const mode = req.body.mode;
    if (!['new', 'add'].includes(mode)) return res.status(400).json({ error: 'Choose a new revenue group or add to an existing group.' });
    const target = mode === 'add' ? c.groups.find(g => g.id === req.body.groupId) : null;
    if (mode === 'add' && !target) return res.status(400).json({ error: 'Choose an existing revenue group.' });
    await Revenue.create({ leadKind: c.kind, leadId: c.lead._id, groupId: target?.id || randomUUID(), requestId, amountPaise: paise, serviceKeys: services.map(s => s.key), services: services.map(s => s.label), createdBy: req.user._id, createdByName: req.user.name || req.user.email });
    return res.status(201).json({ ok: true });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'These services already have revenue. Refresh to view the saved entry.' });
    next(error);
  }
};
exports.closeCold = async (req, res, next) => {
  try {
    const c = await context(req);
    if (!c || c.kind !== 'cold') return res.status(404).json({ error: 'Cold lead not found.' });
    const remarks = String(req.body.remarks || '').trim().slice(0, 1000);
    if (!remarks) return res.status(400).json({ error: 'Closing remarks are required.' });
    const result = await TemporaryLead.updateOne({ _id: c.lead._id, status: 'DRAFT', pipelineClosedAt: null }, { $set: { pipelineClosedAt: new Date(), pipelineClosedBy: req.user._id, pipelineCloseRemarks: remarks } });
    if (!result.modifiedCount) return res.status(409).json({ error: 'Cold lead is already closed or converted.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
};
exports.pipeline = async (req, res, next) => {
  try {
    const [hotAccess, coldAccess] = await Promise.all([leadAccessFilter(req.user), temporaryLeadAccessFilter(req.user)]);
    const [hot, cold] = await Promise.all([
      Lead.find(hotAccess).select('leadCode company status serviceSelections.assignedServiceId serviceSelections.closedBy serviceSelections.closedByText serviceSelections.closedAt serviceSelections.status assignments.assignedServiceId assignments.closedBy assignments.closedByText assignments.closedAt assignments.poStatus assignments.poApprovalStatus assignments.poNumber assignments.poDate assignments.poFinancialYear assignments.poAmount assignments.poYearRows.poNumber assignments.poYearRows.poNo assignments.poYearRows.poDate assignments.poYearRows.poFinancialYear assignments.poYearRows.fy assignments.poYearRows.poAmount assignments.originalPoDetails.poNumber assignments.originalPoDetails.poDate assignments.originalPoDetails.poFinancialYear assignments.originalPoDetails.poAmount closedAt closedBy closedByText createdBy createdByName generatedForUser generatedForName importedCreatedBy createdAt').populate('generatedForUser', 'name email').maxTimeMS(15000).lean(),
      TemporaryLead.find(coldAccess).select('tempLeadCode clientName status convertedLead pipelineClosedAt createdBy createdByName createdAt').populate('createdBy', 'name email').lean()
    ]);
    const entries = await Revenue.find({ $or: [{ leadKind: 'hot', leadId: { $in: hot.map(l => l._id) } }, { leadKind: 'cold', leadId: { $in: cold.map(l => l._id) } }] }).sort({ createdAt: 1 }).lean();
    // Converted Cold records remain visible as closed conversion history; Hot owns current business revenue.
    const origins = await TemporaryLead.find({ status: 'CONVERTED', convertedLead: { $in: hot.map(l => l._id) } }).select('_id convertedLead').lean();
    const inherited = await Revenue.find({ leadKind: 'cold', leadId: { $in: origins.map(l => l._id) } }).lean();
    const rows = [
      ...hot.map(lead => ({ kind: 'hot', lead, closed: hotClosed(lead), inheritedIds: origins.filter(o => String(o.convertedLead) === String(lead._id)).map(o => String(o._id)) })),
      ...cold.map(lead => ({ kind: 'cold', lead, closed: lead.status === 'CONVERTED' || Boolean(lead.pipelineClosedAt), inheritedIds: [] }))
    ].map(({ kind, lead, closed, inheritedIds }) => {
      const own = entries.filter(e => e.leadKind === kind && String(e.leadId) === String(lead._id));
      const groups = groupsFrom([...own, ...inherited.filter(e => inheritedIds.includes(String(e.leadId)))]);
      return { canonicalKey: kind === 'cold' && lead.status === 'CONVERTED' && lead.convertedLead ? `hot:${lead.convertedLead}` : `${kind}:${lead._id}`, converted: kind === 'cold' && lead.status === 'CONVERTED', convertedLeadId: kind === 'cold' && lead.convertedLead ? String(lead.convertedLead) : undefined, poAmountPaise: kind === 'hot' ? purchaseOrders(lead).reduce((n, po) => n + po.amountPaise, 0) : 0, id: String(lead._id), kind, state: closed ? 'closed' : 'open', code: lead.leadCode || lead.tempLeadCode, company: lead.company || lead.clientName, owner: pipelineOwner(lead, kind), serviceCount: kind === 'hot' ? lead.serviceSelections?.length || 1 : 0, groups, revenuePaise: groups.reduce((n, g) => n + g.amountPaise, 0), createdAt: lead.createdAt };
    });
    res.json({ ok: true, rows });
  } catch (error) { next(error); }
};

exports.services = async (req, res, next) => {
  try {
    const c = await context(req);
    if (!c) return res.status(404).json({ error: 'Lead not found or not accessible.' });
    let lead = c.kind === 'hot' ? c.lead : null;
    if (c.kind === 'cold' && c.lead.status === 'CONVERTED' && c.lead.convertedLead) {
      lead = await Lead.findOne({ $and: [{ _id: c.lead.convertedLead }, await leadAccessFilter(req.user)] }).lean();
    }
    res.json({ ok: true, company: c.lead.company || c.lead.clientName, converted: c.lead.status === 'CONVERTED', services: lead ? serviceDetails(lead) : [], purchaseOrders: lead ? purchaseOrders(lead) : [] });
  } catch (error) { next(error); }
};

exports.correct = async (req, res, next) => {
  try {
    if (!userHasAnyRole(req.user, ['admin', 'superadmin'])) return res.status(403).json({ error: 'Only Admin or Super Admin can edit saved revenue.' });
    const c = await context(req);
    if (!c) return res.status(404).json({ error: 'Lead not found or not accessible.' });
    const entry = c.entries.find(e => String(e._id) === String(req.params.entryId));
    if (!entry) return res.status(404).json({ error: 'Revenue contribution not found for this lead.' });
    let amount;
    try { amount = amountPaise(req.body.amount, { allowZero: true }); } catch (e) { return res.status(400).json({ error: e.message, code: 'INVALID_REVENUE_AMOUNT' }); }
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    const requestId = String(req.body.requestId || '');
    if (!reason || !/^[\da-f-]{36}$/i.test(requestId)) return res.status(400).json({ error: 'Correction reason and a valid request ID are required.', code: 'INVALID_REVENUE_CORRECTION' });
    const prior = (entry.corrections || []).find(correction => correction.requestId === requestId);
    if (prior) return prior.afterPaise === amount ? res.json({ ok: true, alreadySaved: true }) : res.status(409).json({ error: 'Correction request ID already used.' });
    if (!Number.isSafeInteger(req.body.expectedPaise) || req.body.expectedPaise !== entry.amountPaise || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision !== (entry.corrections || []).length) return res.status(409).json({ error: 'Revenue changed. Refresh before correcting it.' });
    const updated = await Revenue.findOneAndUpdate({ _id: entry._id, amountPaise: req.body.expectedPaise, 'corrections.requestId': { $ne: requestId }, $expr: { $eq: [{ $size: { $ifNull: ['$corrections', []] } }, req.body.expectedRevision] } }, {
      $set: { amountPaise: amount },
      $push: { corrections: { requestId, beforePaise: entry.amountPaise, afterPaise: amount, reason, actor: req.user._id, actorName: req.user.name || req.user.email, at: new Date() } }
    }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ error: 'Another administrator changed this revenue. Refresh and try again.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
};

exports.__test = { pipelineOwner };
