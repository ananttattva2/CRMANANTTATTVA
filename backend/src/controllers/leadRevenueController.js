const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const TemporaryLead = require('../models/TemporaryLead');
const Revenue = require('../models/LeadRevenue');
const Quotation = require('../models/Quotation');
const { leadAccessFilter } = require('./leadController');
const { temporaryLeadAccessFilter } = require('./temporaryLeadController');
const { amountPaise, serviceRows, groupsFrom, hotClosed, purchaseOrders, serviceDetails, clientContactDetails } = require('../services/leadRevenue');
const { userHasAnyRole } = require('../utils/userRoles');
const { latestQuotationAmountsByLead } = require('../services/latestLeadQuotation');

function pipelineOwner(lead, kind) {
  const currentOwner = kind === 'hot' ? (lead.generatedForUser || lead.createdOnBehalfOfUser || lead.createdBy) : lead.createdBy;
  return currentOwner?.name || currentOwner?.email
    || (kind === 'hot' ? lead.generatedForName : '')
    || (kind === 'hot' ? lead.createdOnBehalfOfName : '')
    || lead.importedCreatedBy || lead.createdByName || 'Unassigned';
}

function pipelineOwnerDetails(lead, kind) {
  const currentOwner = kind === 'hot' ? (lead.generatedForUser || lead.createdOnBehalfOfUser || lead.createdBy) : lead.createdBy;
  return {
    id: String(currentOwner?._id || currentOwner || ''),
    name: pipelineOwner(lead, kind),
    active: currentOwner?.isActive !== false
  };
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
  const startedAt = Date.now();
  try {
    const compactAdmin = Lead.db?.readyState === 1 && userHasAnyRole(req.user, ['admin', 'superadmin']);
    const [hotAccess, coldAccess] = await Promise.all([leadAccessFilter(req.user), temporaryLeadAccessFilter(req.user)]);
    const [hot, cold] = await Promise.all([
      (compactAdmin ? require('../services/compactReadSnapshot').compactReadSnapshot(Lead, { filter: { deletedAt: null }, versionIndex: { deletedAt: 1, updatedAt: 1, _id: 1 }, selection: 'communicationModeParent communicationMode leadCode sourceLeadId company status serviceSelections.assignedServiceId serviceSelections.eprCategory serviceSelections.servicesOffered serviceSelections.applicableService serviceSelections.closedBy serviceSelections.closedByText serviceSelections.closedAt serviceSelections.closureRequestedBy serviceSelections.closureRequestedByText serviceSelections.poStatus serviceSelections.poYearRows.poNumber serviceSelections.poYearRows.poNo serviceSelections.status serviceSelections.accountsRecordId assignments.assignedServiceId assignments.closedBy assignments.closedByText assignments.closedAt assignments.closureRequestedBy assignments.closureRequestedByText assignments.poStatus assignments.poApprovalStatus assignments.poNumber assignments.poDate assignments.poFinancialYear assignments.poAmount assignments.poYearRows.poNumber assignments.poYearRows.poNo assignments.poYearRows.poDate assignments.poYearRows.poFinancialYear assignments.poYearRows.fy assignments.poYearRows.poAmount assignments.originalPoDetails.poNumber assignments.originalPoDetails.poDate assignments.originalPoDetails.poFinancialYear assignments.originalPoDetails.poAmount noOwner.active noOwner.previousOwner.id noOwner.previousOwner.name noOwner.previousOwner.email closedAt closedBy closedByText createdBy createdByName generatedForUser generatedForName createdOnBehalfOfUser createdOnBehalfOfName importedCreatedBy createdAt' }).then(rows => Lead.populate(rows, ['generatedForUser', 'createdOnBehalfOfUser', 'createdBy'].map(path => ({ path, select: 'name email isActive' })))) : Lead.find(hotAccess).select('communicationModeParent communicationMode leadCode sourceLeadId company status serviceSelections.assignedServiceId serviceSelections.eprCategory serviceSelections.servicesOffered serviceSelections.applicableService serviceSelections.closedBy serviceSelections.closedByText serviceSelections.closedAt serviceSelections.closureRequestedBy serviceSelections.closureRequestedByText serviceSelections.poStatus serviceSelections.poYearRows.poNumber serviceSelections.poYearRows.poNo serviceSelections.status serviceSelections.accountsRecordId assignments.assignedServiceId assignments.closedBy assignments.closedByText assignments.closedAt assignments.closureRequestedBy assignments.closureRequestedByText assignments.poStatus assignments.poApprovalStatus assignments.poNumber assignments.poDate assignments.poFinancialYear assignments.poAmount assignments.poYearRows.poNumber assignments.poYearRows.poNo assignments.poYearRows.poDate assignments.poYearRows.poFinancialYear assignments.poYearRows.fy assignments.poYearRows.poAmount assignments.originalPoDetails.poNumber assignments.originalPoDetails.poDate assignments.originalPoDetails.poFinancialYear assignments.originalPoDetails.poAmount noOwner.active noOwner.previousOwner.id noOwner.previousOwner.name noOwner.previousOwner.email closedAt closedBy closedByText createdBy createdByName generatedForUser generatedForName createdOnBehalfOfUser createdOnBehalfOfName importedCreatedBy createdAt').populate('generatedForUser', 'name email isActive').populate('createdOnBehalfOfUser', 'name email isActive').populate('createdBy', 'name email isActive').maxTimeMS(15000).lean()),
      (compactAdmin ? require('../services/compactReadSnapshot').compactReadSnapshot(TemporaryLead, { filter: { deletedAt: null }, versionIndex: { deletedAt: 1, updatedAt: 1, _id: 1 }, selection: 'communicationMode tempLeadCode clientName status convertedLead pipelineClosedAt createdBy createdByName createdAt' }).then(rows => TemporaryLead.populate(rows, { path: 'createdBy', select: 'name email isActive' })) : TemporaryLead.find(coldAccess).select('communicationMode tempLeadCode clientName status convertedLead pipelineClosedAt createdBy createdByName createdAt').populate('createdBy', 'name email isActive').maxTimeMS(15000).lean())

    ]);
    const hotIds = hot.map((lead) => lead._id);
    const hotIdStrings = hotIds.map(String);
    const hotCodes = hot.flatMap((lead) => [lead.leadCode, lead.sourceLeadId]).map((value) => String(value || '').trim()).filter(Boolean);
    const [entries, quotations] = await Promise.all([
      Revenue.find({ $or: [{ leadKind: 'hot', leadId: { $in: hotIds } }, { leadKind: 'cold', leadId: { $in: cold.map(l => l._id) } }] })
        .select('leadKind leadId amountPaise').sort({ createdAt: 1 }).maxTimeMS(15000).lean(),
      (compactAdmin ? require('../services/compactReadSnapshot').compactReadSnapshot(Quotation, { filter: { deletedAt: null, status: { $in: ['submitted', 'sent', 'admin_approved', 'approved'] }, serviceState: { $ne: 'closed' } }, versionIndex: { deletedAt: 1, status: 1, serviceState: 1, updatedAt: 1, _id: 1 }, selection: '_id leadRef leadId leadCode businessLeadCode quotationNumber quotationDate createdAt grandTotal status serviceState' }) : Quotation.find({
        status: { $in: ['submitted', 'sent', 'admin_approved', 'approved'] },
        serviceState: { $ne: 'closed' },
        $or: [
          { leadRef: { $in: hotIds } },
          { leadId: { $in: [...hotIdStrings, ...hotCodes] } },
          { leadCode: { $in: hotCodes } },
          { businessLeadCode: { $in: hotCodes } }
        ]
      }).select('_id leadRef leadId leadCode businessLeadCode quotationNumber quotationDate createdAt grandTotal status serviceState').maxTimeMS(15000).lean())
    ]);
    const latestQuotationByLead = latestQuotationAmountsByLead(hot, quotations);
    const revenueByLead = new Map();
    for (const entry of entries) {
      const key = `${entry.leadKind}:${entry.leadId}`;
      revenueByLead.set(key, (revenueByLead.get(key) || 0) + Number(entry.amountPaise || 0));
    }
    // Converted Cold records remain available as audit history, while their
    // revenue is inherited by the current Hot business lead.
    const originIdsByHot = new Map();
    for (const lead of cold) {
      if (lead.status !== 'CONVERTED' || !lead.convertedLead) continue;
      const key = String(lead.convertedLead);
      if (!originIdsByHot.has(key)) originIdsByHot.set(key, []);
      originIdsByHot.get(key).push(String(lead._id));
    }
    const ownerNames = new Map(hot.map(lead => { const owner = pipelineOwnerDetails(lead, 'hot'); return [String(owner.id || ''), owner.name]; }).filter(([id]) => id));
    const rows = [
      ...hot.map(lead => ({ kind: 'hot', lead, closed: hotClosed(lead), inheritedIds: originIdsByHot.get(String(lead._id)) || [] })),
      ...cold.map(lead => ({ kind: 'cold', lead, closed: lead.status === 'CONVERTED' || Boolean(lead.pipelineClosedAt), inheritedIds: [] }))
    ].map(({ kind, lead, closed, inheritedIds }) => {
      const owner = pipelineOwnerDetails(lead, kind);
      const ownRevenue = revenueByLead.get(`${kind}:${lead._id}`) || 0;
      const inheritedRevenue = inheritedIds.reduce((sum, id) => sum + (revenueByLead.get(`cold:${id}`) || 0), 0);
      const serviceInterests = kind === 'hot' ? [...new Set((lead.serviceSelections || []).flatMap((service) => [service.servicesOffered, service.applicableService, service.eprCategory]).map((value) => String(value || '').trim()).filter(Boolean))] : [];
      return { communicationModeParent: String(lead.communicationModeParent || '').trim(), communicationMode: String(lead.communicationMode || '').trim(), canonicalKey: kind === 'cold' && lead.status === 'CONVERTED' && lead.convertedLead ? `hot:${lead.convertedLead}` : `${kind}:${lead._id}`, converted: kind === 'cold' && lead.status === 'CONVERTED', convertedLeadId: kind === 'cold' && lead.convertedLead ? String(lead.convertedLead) : undefined, poAmountPaise: kind === 'hot' ? purchaseOrders(lead).reduce((n, po) => n + po.amountPaise, 0) : 0, quotationAmountPaise: kind === 'hot' && !closed ? (latestQuotationByLead.get(String(lead._id)) || 0) : 0, id: String(lead._id), kind, state: closed ? 'closed' : 'open', code: lead.leadCode || lead.tempLeadCode, company: lead.company || lead.clientName, previousOwner: lead.noOwner?.active ? ownerNames.get(String(lead.noOwner?.previousOwner?.id || '')) || lead.noOwner?.previousOwner?.name || lead.noOwner?.previousOwner?.email || '' : '', previousOwnerId: lead.noOwner?.active ? String(lead.noOwner?.previousOwner?.id || '') : '', owner: owner.name, ownerId: owner.id, ownerActive: owner.active, serviceCount: kind === 'hot' ? lead.serviceSelections?.length || 1 : 0, serviceInterests, revenuePaise: ownRevenue + inheritedRevenue, createdAt: lead.createdAt };

    });
    res.set('Server-Timing', `pipeline;dur=${Date.now() - startedAt}`);
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
    res.json({ ok: true, company: c.lead.company || c.lead.clientName, converted: c.lead.status === 'CONVERTED', clientDetails: clientContactDetails(lead || c.lead), services: lead ? serviceDetails(lead) : [], purchaseOrders: lead ? purchaseOrders(lead) : [] });
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

exports.__test = { pipelineOwner, pipelineOwnerDetails };
