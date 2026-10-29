const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const Sequence = require('../models/Sequence');
const TemporaryLead = require('../models/TemporaryLead');
const CalendarItem = require('../models/CalendarItem');
const User = require('../models/User');
const mongoose = require('mongoose');
const { normalizeCompanyIdentity } = require('../services/crmRecordPersistence');
const { createLeadRecordInternal } = require('./leadController');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');

const combineFilters = (...filters) => {
  const active = filters.filter((filter) => filter && Object.keys(filter).length);
  return active.length > 1 ? { $and: active } : active[0] || {};
};

async function temporaryLeadAccessFilter(user) {
  return ownerFilter(await getVisibleUserScope(user), 'createdBy', '', ['createdByName', 'createdByEmail']);
}

async function nextTemporaryLeadCode() {
  const sequence = await Sequence.findOneAndUpdate(
    { key: 'temporary_lead' },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `ATPL-TEMP-${String(sequence.value).padStart(4, '0')}`;
}

const cleanText = (value, maxLength) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeTemporaryLeadPayload(source = {}) {
  const clientName = cleanText(source.companyName || source.clientName, 240);
  const personName = cleanText(source.personName || source.contactPerson, 160);
  const email = normalizeEmail(source.email || source.emailId || source.emails);
  const phone = normalizePhone(source.phone || source.phoneNo || source.mobileNo1);
  const sector = cleanText(source.sector || source.industryType, 160);
  return { clientName, personName, email, phone, sector, companyIdentity: normalizeCompanyIdentity(clientName), emailIdentity: email, phoneIdentity: phone };
}

function validateTemporaryLeadPayload(data) {
  if (data.clientName.length < 2) return 'Company name must contain at least 2 characters.';
  if (data.personName.length < 2) return 'Person name must contain at least 2 characters.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'Enter a valid email ID.';
  if (data.phone.length < 10 || data.phone.length > 15) return 'Phone number must contain 10 to 15 digits.';
  if (data.sector.length < 2) return 'Sector must contain at least 2 characters.';
  return '';
}

async function findTemporaryLeadDuplicate(data) {
  const temporary = await TemporaryLead.findOne({
    $or: [
      { companyIdentity: data.companyIdentity },
      { emailIdentity: data.emailIdentity },
      { phoneIdentity: data.phoneIdentity }
    ]
  }).select('_id tempLeadCode clientName companyIdentity email emailIdentity phone phoneIdentity status').lean();
  if (temporary) {
    const match = temporary.companyIdentity === data.companyIdentity ? 'company name'
      : temporary.emailIdentity === data.emailIdentity ? 'email ID' : 'phone number';
    return { source: 'temporary', match, code: temporary.tempLeadCode, company: temporary.clientName };
  }

  const emailExpression = new RegExp(`^${escapeRegex(data.emailIdentity)}$`, 'i');
  const companyExpression = new RegExp(`^\\s*${escapeRegex(data.companyIdentity)}`, 'i');
  const permanentCandidates = await Lead.find({
    $or: [
      { companyIdentity: data.companyIdentity },
      { company: companyExpression },
      { emails: emailExpression },
      { mobileNo1: data.phoneIdentity },
      { mobileNo2: data.phoneIdentity },
      { whatsappNo: data.phoneIdentity }
    ]
  }).select('_id leadCode company companyIdentity emails mobileNo1 mobileNo2 whatsappNo').lean();
  const permanent = permanentCandidates.find((row) => {
    const emails = String(row.emails || '').split(/[;,]/).map(normalizeEmail).filter(Boolean);
    const phones = [row.mobileNo1, row.mobileNo2, row.whatsappNo].map(normalizePhone).filter(Boolean);
    return normalizeCompanyIdentity(row.company) === data.companyIdentity || emails.includes(data.emailIdentity) || phones.includes(data.phoneIdentity);
  });
  if (!permanent) return null;
  const match = permanent.companyIdentity === data.companyIdentity ? 'company name'
    : [permanent.mobileNo1, permanent.mobileNo2, permanent.whatsappNo].includes(data.phoneIdentity) ? 'phone number' : 'email ID';
  return { source: 'permanent', match, code: permanent.leadCode, company: permanent.company };
}

async function createTemporaryLeadRecord(source, user) {
  const data = normalizeTemporaryLeadPayload(source);
  const validationError = validateTemporaryLeadPayload(data);
  if (validationError) return { error: validationError, code: 'INVALID_TEMPORARY_LEAD' };
  const duplicate = await findTemporaryLeadDuplicate(data);
  if (duplicate) return {
    error: `${data.clientName} was not saved because its ${duplicate.match} already exists in ${duplicate.code || 'the CRM'}.`,
    code: 'DUPLICATE_TEMPORARY_LEAD',
    duplicate
  };
  const temporaryLead = await TemporaryLead.create({
    tempLeadCode: await nextTemporaryLeadCode(),
    ...data,
    createdBy: user._id,
    createdByName: user.name || user.email,
    createdByEmail: user.email
  });
  return { temporaryLead };
}

exports.list = async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim().toUpperCase();
  const allocationOwner = String(req.query.allocationOwner || '').trim();
  const filter = {};
  if (search) filter.$or = [
    { tempLeadCode: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    { clientName: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    { personName: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    { email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    { phone: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    { sector: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
  ];
  if (['DRAFT', 'CONVERTED'].includes(status)) filter.status = status;
  if (allocationOwner === 'unassigned') filter.createdBy = null;
  else if (mongoose.Types.ObjectId.isValid(allocationOwner)) filter.createdBy = allocationOwner;
  const accessFilter = await temporaryLeadAccessFilter(req.user);
  const scopedFilter = combineFilters(filter, accessFilter);
  if (req.query.view === 'review' && req.query.snapshot === 'true') {
    const rows = await TemporaryLead.find(scopedFilter)
      .select('tempLeadCode clientName status createdAt createdBy createdByName createdByEmail followUpRemarks')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .maxTimeMS(15000)
      .lean();
    return res.json({ ok: true, temporaryLeads: rows, pagination: { page: 1, limit: rows.length, total: rows.length, pages: 1 } });
  }
  const [rows, total, draftCount, convertedCount] = await Promise.all([
    TemporaryLead.find(scopedFilter).populate('createdBy', 'name email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    TemporaryLead.countDocuments(scopedFilter),
    TemporaryLead.countDocuments(combineFilters({ status: 'DRAFT' }, accessFilter)),
    TemporaryLead.countDocuments(combineFilters({ status: 'CONVERTED' }, accessFilter))
  ]);
  res.json({ ok: true, temporaryLeads: rows, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }, counts: { total: draftCount + convertedCount, draft: draftCount, converted: convertedCount } });
};

exports.reassign = async (req, res) => {
  const userId = String(req.body?.userId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'Select a valid CRM user.' });
  }

  const [row, target] = await Promise.all([
    TemporaryLead.findById(req.params.id),
    User.findOne({ _id: userId, isActive: { $ne: false } }).select('_id name email role')
  ]);
  if (!row) return res.status(404).json({ error: 'Temporary lead not found.' });
  if (!target) return res.status(404).json({ error: 'Active CRM user not found.' });
  if (row.status === 'CONVERTED') {
    return res.status(409).json({ error: 'This record is already a permanent lead. Reassign it from the Leads tab.' });
  }

  const previousUserId = id => String(id || '');
  if (previousUserId(row.createdBy) !== previousUserId(target._id)) {
    if (!Array.isArray(row.reassignmentHistory)) row.reassignmentHistory = [];
    row.reassignmentHistory.unshift({
      fromUserId: previousUserId(row.createdBy),
      fromName: row.createdByName || row.createdByEmail || '',
      toUserId: previousUserId(target._id),
      toName: target.name || target.email,
      changedBy: previousUserId(req.user._id),
      changedByName: req.user.name || req.user.email,
      changedAt: new Date().toISOString()
    });
    row.createdBy = target._id;
    row.createdByName = target.name || target.email;
    row.createdByEmail = target.email || '';
    await row.save();
    await CalendarItem.updateMany(
      { temporaryLeadId: String(row._id), status: { $ne: 'completed' } },
      { $set: { assignedTo: String(target._id), assignedToId: String(target._id), assignedToName: target.name || target.email, assignedToEmail: target.email || '' } }
    );
  }

  await row.populate('createdBy', 'name email role');
  res.json({ ok: true, message: 'Temporary lead reassigned successfully.', temporaryLead: row });
};

exports.create = async (req, res) => {
  const result = await createTemporaryLeadRecord(req.body, req.user);
  if (result.error) return res.status(result.code === 'DUPLICATE_TEMPORARY_LEAD' ? 409 : 400).json(result);
  res.status(201).json({ ok: true, temporaryLead: result.temporaryLead });
};

exports.bulkCreate = async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'The Excel file does not contain any temporary leads.' });
  if (rows.length > 1000) return res.status(400).json({ error: 'A maximum of 1,000 temporary leads can be uploaded at once.' });
  const inserted = [];
  const skipped = [];
  for (let index = 0; index < rows.length; index += 1) {
    const result = await createTemporaryLeadRecord(rows[index], req.user);
    if (result.temporaryLead) inserted.push({ row: index + 2, tempLeadCode: result.temporaryLead.tempLeadCode, companyName: result.temporaryLead.clientName });
    else skipped.push({ row: index + 2, companyName: cleanText(rows[index]?.companyName || rows[index]?.clientName, 240), error: result.error, code: result.code, duplicate: result.duplicate });
  }
  res.status(inserted.length ? 201 : 200).json({ ok: true, inserted, skipped, summary: { total: rows.length, inserted: inserted.length, skipped: skipped.length } });
};

exports.convert = async (req, res) => {
  const row = await TemporaryLead.findOne(combineFilters({ _id: req.params.id }, await temporaryLeadAccessFilter(req.user)));
  if (!row) return res.status(404).json({ error: 'Temporary lead not found.' });
  if (row.status === 'CONVERTED') {
    const lead = row.convertedLead ? await Lead.findById(row.convertedLead).lean() : null;
    return res.json({ ok: true, temporaryLead: row, lead, alreadyConverted: true });
  }
  const duplicate = await Lead.findOne({ companyIdentity: row.companyIdentity }).select('_id leadCode company').lean();
  if (duplicate) return res.status(409).json({ error: `${duplicate.company} already exists as ${duplicate.leadCode}.`, code: 'DUPLICATE_LEAD_COMPANY', duplicate });
  const lead = await createLeadRecordInternal({ company: row.clientName, contactPerson: row.personName, emails: row.email, mobileNo1: row.phone, industryType: row.sector, status: 'Potential - Interested', workflowStatus: 'draft', source: 'Temporary Lead', notes: `Converted from ${row.tempLeadCode}` }, req.user);
  await LeadActivity.create({ lead: lead._id, type: 'lead_created', title: 'Lead created from temporary lead', description: `${row.tempLeadCode} converted for ${row.clientName}`, actor: req.user._id });
  row.status = 'CONVERTED'; row.convertedLead = lead._id; row.convertedLeadCode = lead.leadCode; row.convertedAt = new Date();
  await row.save();
  res.status(201).json({ ok: true, temporaryLead: row, lead });
};

exports.saveFollowUp = async (req, res) => {
  const row = await TemporaryLead.findOne(combineFilters({ _id: req.params.id }, await temporaryLeadAccessFilter(req.user)));
  if (!row) return res.status(404).json({ error: 'Temporary lead not found.' });
  if (row.status === 'CONVERTED') return res.status(409).json({ error: 'Converted temporary leads must be followed up from the permanent Lead.' });
  const scheduledDate = String(req.body.scheduledDate || '').trim();
  const scheduledTime = String(req.body.scheduledTime || '').trim();
  const remarks = String(req.body.remarks || '').trim();
  const priority = String(req.body.priority || 'Medium').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !remarks) return res.status(400).json({ error: 'Follow-up date and remarks are required.' });
  const now = new Date().toISOString();
  if (!Array.isArray(row.followUpHistory)) row.followUpHistory = [];
  const previousOpen = row.followUpHistory.find((entry) => String(entry.status || '').toLowerCase() === 'open');
  row.followUpHistory = row.followUpHistory.map((entry) => String(entry.status || '').toLowerCase() === 'open' ? { ...entry, status: 'updated', updatedAt: now, updatedBy: req.user.name || req.user.email } : entry);
  if ((row.nextFollowUpDate || row.nextFollowUpTime || row.followUpRemarks) && !previousOpen) row.followUpHistory.unshift({ scheduledDate: row.nextFollowUpDate, scheduledTime: row.nextFollowUpTime, remarks: row.followUpRemarks, priority: row.followUpPriority, status: 'updated', updatedAt: now, updatedBy: req.user.name || req.user.email });
  row.nextFollowUpDate = scheduledDate; row.nextFollowUpTime = scheduledTime; row.followUpRemarks = remarks; row.followUpPriority = priority; row.followUpFlag = 'GREEN';
  const calendarItem = await CalendarItem.create({ externalId: `temp-followup-${row._id}-${Date.now()}`, type: 'followup', category: 'Follow-Up', title: `Temporary lead follow-up: ${row.clientName}`, description: remarks, clientName: row.clientName, leadNumber: row.tempLeadCode, leadCompanyName: row.clientName, temporaryLeadId: String(row._id), scheduledDate, scheduledTime, priority, status: 'open', assignedTo: String(req.user._id), assignedToId: String(req.user._id), assignedToName: req.user.name || req.user.email, assignedToEmail: req.user.email || '', createdBy: req.user.name || req.user.email, createdByUser: req.user._id, source: 'temporary-lead' });
  row.followUpHistory.unshift({ calendarItemId: String(calendarItem._id), scheduledDate, scheduledTime, remarks, priority, status: 'open', createdAt: now, createdBy: req.user.name || req.user.email });
  await row.save();
  res.json({ ok: true, temporaryLead: row, calendarItem });
};

exports.closeFollowUp = async (req, res) => {
  const row = await TemporaryLead.findOne(combineFilters({ _id: req.params.id }, await temporaryLeadAccessFilter(req.user)));
  if (!row) return res.status(404).json({ error: 'Temporary lead not found.' });
  const remarks = String(req.body.remarks || '').trim();
  if (!remarks) return res.status(400).json({ error: 'Closing remarks are required.' });
  if (!row.nextFollowUpDate && !row.nextFollowUpTime && !row.followUpRemarks) return res.status(409).json({ error: 'No open follow-up was found.' });
  const closedAt = new Date().toISOString();
  const closedBy = req.user.name || req.user.email || 'CRM User';
  const calendarItem = await CalendarItem.findOne({ temporaryLeadId: String(row._id), status: { $ne: 'completed' } }).sort({ createdAt: -1 });
  if (calendarItem) {
    calendarItem.status = 'completed';
    calendarItem.completedAt = closedAt;
    calendarItem.completionRemarks = remarks;
    calendarItem.completionHistory = [{ remarks, completedBy: closedBy, completedAt: closedAt }, ...(calendarItem.completionHistory || [])];
    await calendarItem.save();
  }
  if (!Array.isArray(row.followUpHistory)) row.followUpHistory = [];
  const calendarItemId = String(calendarItem?._id || '');
  let closedExisting = false;
  row.followUpHistory = row.followUpHistory.map((entry) => {
    const matchesCurrent = String(entry.status || '').toLowerCase() === 'open'
      && (!calendarItemId || !entry.calendarItemId || String(entry.calendarItemId) === calendarItemId);
    if (!matchesCurrent) return entry;
    closedExisting = true;
    return { ...entry, remarks, status: 'closed', closedAt, closedBy };
  });
  if (!closedExisting) row.followUpHistory.unshift({ calendarItemId, scheduledDate: row.nextFollowUpDate, scheduledTime: row.nextFollowUpTime, remarks, priority: row.followUpPriority || 'Medium', status: 'closed', closedAt, closedBy });
  row.nextFollowUpDate = ''; row.nextFollowUpTime = ''; row.followUpRemarks = ''; row.followUpFlag = 'GREEN';
  await row.save();
  res.json({ ok: true, temporaryLead: row, calendarItem });
};

exports.__test = { nextTemporaryLeadCode, normalizeTemporaryLeadPayload, validateTemporaryLeadPayload };
