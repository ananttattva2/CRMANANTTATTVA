const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const Lead = require('../models/Lead');
const User = require('../models/User');
const ReminderDelivery = require('../models/ReminderDelivery');
const mailer = require('../utils/mailer');
const { userHasAnyRole } = require('../utils/userRoles');
const { poClosed } = require('../../../shared/leadPoClosure.cjs');
const WEEK = 7 * 24 * 60 * 60 * 1000;
const LEASE = 15 * 60 * 1000;
const QUOTE_FIELDS = 'quotationNumber companyName leadDetails.companyName leadRef leadId leadCode businessLeadCode createdBy createdByName preparedByName leadGeneratedBy assignedUserName status managementApproval approvalDecision createdAt items';
const LEAD_FIELDS = 'leadCode sourceLeadId createdBy createdByName createdByEmail createdByCrmUserId importedCreatedBy generatedForUser generatedForName generatedForEmail assignedTo assignedToText assignedToEmail assignedStaff assignedStaffText assignedStaffEmail serviceSelections assignments';
let running = false;
let started = false;
const text = value => String(value?._id || value || '').trim();
const normalize = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const serviceId = value => text(value?.assignedServiceId || value?.serviceAssignmentId || value?.assignmentId);
const date = value => { const result = value ? new Date(value) : null; return result && Number.isFinite(+result) ? result : null; };
const approved = quote => ['approved', 'admin_approved'].includes(String(quote?.status || '').toLowerCase());
function approvalAt(quote) { return date(quote.managementApproval?.adminApprovedAt) || date(quote.approvalDecision?.actionAt) || date(quote.managementApproval?.actionAt) || date(quote.createdAt); }
function reference(quote) {
  const ids = [quote.leadRef, quote.leadId].map(text).filter(value => mongoose.isValidObjectId(value));
  const codes = [quote.leadCode, quote.businessLeadCode, quote.leadId].map(text).filter(Boolean);
  return { ids, codes };
}
function leadMatches(quote, lead) {
  const { ids, codes } = reference(quote);
  return ids.includes(text(lead._id)) || codes.includes(text(lead.leadCode)) || codes.includes(text(lead.sourceLeadId));
}
function assignmentForItem(item, index, lead = {}) {
  lead = lead || {};
  const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
  const services = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
  const id = serviceId(item);
  const merge = (assignment, service = {}) => ({ ...(services.length <= 1 && assignments.length <= 1 ? lead : {}), ...service, ...assignment });
  if (id) {
    const found = assignments.find(row => serviceId(row) === id);
    if (found) return merge(found, services.find(row => serviceId(row) === id));
    const position = services.findIndex(row => serviceId(row) === id);
    return position >= 0 && !serviceId(assignments[position]) ? merge(assignments[position] || {}, services[position]) : {};
  }
  const matches = services.map((service, position) => ({ service, position })).filter(({ service }) =>
    normalize(service.servicesOffered || service.applicableService) === normalize(item.servicesOffered || item.applicableService)
    && normalize(service.subApplicantType || service.piboCategory || service.applicantType) === normalize(item.subApplicantType || item.piboCategory || item.applicantType)
    && normalize(service.eprCategory || service.serviceCategory) === normalize(item.eprCategory || item.serviceCategory));
  if (matches.length === 1) return merge(assignments.find(row => serviceId(row) && serviceId(row) === serviceId(matches[0].service)) || assignments[matches[0].position] || {}, matches[0].service);
  if (Number.isInteger(item.sourceServiceIndex) && item.sourceServiceIndex >= 0) return assignments[item.sourceServiceIndex] ? merge(assignments[item.sourceServiceIndex], services[item.sourceServiceIndex]) : !assignments.length && services.length <= 1 && item.sourceServiceIndex === 0 ? { ...lead, ...services[0] } : {};
  if (assignments.length === 1 && services.length <= 1 && index === 0) return merge(assignments[0], services[0]);
  if (!assignments.length && services.length <= 1 && index === 0) return { ...lead, ...services[0] };
  return {};
}
function itemPoClosed(quote, assignment) {
  const rows = [...(Array.isArray(assignment.poYearRows) ? assignment.poYearRows : []), ...(assignment.originalPoDetails ? [assignment.originalPoDetails] : [])];
  const linked = rows.filter(row => row.quotationId || row.quotationNumber);
  if (!linked.length) return poClosed(assignment);
  const matching = linked.filter(row => text(row.quotationId) === text(quote._id) || (quote.quotationNumber && text(row.quotationNumber) === quote.quotationNumber));
  return matching.length > 0 && poClosed({ ...assignment, originalPoDetails: undefined, poYearRows: matching });
}
function openServices(quote, lead) {
  return (quote.items || []).map((item, itemIndex) => ({ item, itemIndex, assignment: assignmentForItem(item, itemIndex, lead) }))
    .filter(row => !itemPoClosed(quote, row.assignment));
}
function recipientUsers(quote, lead = {}, pending, users) {
  lead = lead || {};
  const tokens = [];
  function add(value) { if (value?.toHexString) { tokens.push(value.toHexString().toLowerCase());return; } if (value && typeof value === 'object') { add(value._id); add(value.email); add(value.name); } else if (value) tokens.push(String(value).trim().toLowerCase()); }
  [quote.createdBy, quote.createdByName, quote.preparedByName, quote.leadGeneratedBy, quote.assignedUserName,
    lead.createdBy, lead.createdByName, lead.createdByEmail, lead.createdByCrmUserId, lead.importedCreatedBy,
    lead.generatedForUser, lead.generatedForName, lead.generatedForEmail,
    lead.assignedTo, lead.assignedToText, lead.assignedToEmail, lead.assignedStaff, lead.assignedStaffText, lead.assignedStaffEmail].forEach(add);
  pending.forEach(({ assignment, item }) => {
    [assignment.createdBy, assignment.createdByName, assignment.createdByEmail, assignment.createdByCrmUserId, assignment.assignedTo, assignment.assignedToText, assignment.assignedToEmail, assignment.assignedStaff, assignment.assignedStaffText, assignment.assignedStaffEmail, item.serviceAddedBy].forEach(add);
  });
  const selected = new Map();
  const active = users.filter(user => user.isActive !== false && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email || '').trim()));
  active.filter(user => userHasAnyRole(user, ['admin', 'superadmin'])).forEach(user => selected.set(user.email.toLowerCase(), user));
  for (const token of new Set(tokens)) {
    const exact = active.filter(user => [text(user._id), user.crmUserId, user.email].filter(Boolean).some(value => String(value).toLowerCase() === token));
    const matches = exact.length ? exact : active.filter(user => String(user.name || '').trim().toLowerCase() === token);
    if (exact.length || matches.length === 1) matches.forEach(user => selected.set(user.email.toLowerCase(), user));
  }
  return [...selected.values()];
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function emailHtml(recipient, entries) {
  const total = entries.reduce((sum, entry) => sum + entry.pending.length, 0);
  let origin = 'https://crmananttattva.com';
  try { origin = new URL(process.env.APP_URL || process.env.FRONTEND_URL || origin).origin; } catch {}
  const body = entries.flatMap(({ quote, pending }) => pending.map(({ item, itemIndex }) => `<tr><td style="padding:12px;border-bottom:1px solid #e2e8f0">${escape(quote.quotationNumber)}</td><td style="padding:12px;border-bottom:1px solid #e2e8f0">${escape(quote.companyName || quote.leadDetails?.companyName || 'Client')}</td><td style="padding:12px;border-bottom:1px solid #e2e8f0">${itemIndex + 1}. ${escape(item.servicesOffered || item.applicableService || item.serviceCategory || 'Service')}<br><small>${escape(item.subApplicantType || item.piboCategory || item.applicantType || '')} · ${escape(item.eprCategory || item.serviceCategory || '')}</small></td><td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#b91c1c;font-weight:bold">Still Not Closed</td></tr>`)).join('');
  return `<div style="background:#f1f5f9;padding:24px;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:950px;margin:auto;background:white;border:1px solid #dbe5e9;border-radius:18px;overflow:hidden"><header style="background:#0f766e;color:white;padding:28px"><p style="font-size:11px;letter-spacing:2px">ANANT TATTVA CRM · WEEKLY FOLLOW-UP</p><h1 style="font-size:24px;margin:10px 0">Approved quotations — PO closure pending</h1></header><div style="padding:26px"><p>Hello ${escape(recipient.name || recipient.email)},</p><p>${entries.length} approved quotation(s) have <strong>${total} service(s)</strong> whose PO is still not closed. Please follow up and close the remaining service POs.</p><p style="padding:12px;background:#fff7ed;border-radius:10px;color:#9a3412">Closed services are excluded. Reminders continue weekly only while services remain open.</p><table style="width:100%;border-collapse:collapse;font-size:13px"><thead style="background:#f8fafc"><tr>${['Quotation','Company','Pending service','PO status'].map(label => `<th align="left" style="padding:12px">${label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table><a href="${escape(origin)}/sales/quotations" style="display:inline-block;margin-top:24px;padding:13px 20px;background:#0f766e;color:white;text-decoration:none;border-radius:9px;font-weight:bold">Open Quotations</a><p style="font-size:11px;color:#64748b;margin-top:24px">Internal reminder for the relevant sales owner, quotation user, assigned staff, Admin and Super Admin. This is not a client email.</p></div></div></div>`;
}
async function claim(key, now) {
  try { return await ReminderDelivery.create({ key, status: 'sending', leaseUntil: new Date(+now + LEASE) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    return ReminderDelivery.findOneAndUpdate({ key, status: 'sending', leaseUntil: { $lte: now } }, { $set: { leaseUntil: new Date(+now + LEASE) }, $inc: { attempts: 1 } }, { new: true });
  }
}
async function findLead(quote) {
  const { ids, codes } = reference(quote);
  if (!ids.length && !codes.length) return null;
  return Lead.findOne({ $or: [{ _id: { $in: ids } }, { leadCode: { $in: codes } }, { sourceLeadId: { $in: codes } }] }).select(LEAD_FIELDS).lean();
}
async function runApprovedQuotationPoReminders({ now = new Date(), dryRun = false } = {}) {
  if (running) return { skipped: true, reason: 'already-running' };
  running = true;
  try {
    const quotes = await Quotation.find({ status: { $in: ['approved', 'admin_approved'] } }).select(QUOTE_FIELDS).lean();
    const due = quotes.filter(quote => approved(quote) && approvalAt(quote) && +now - +approvalAt(quote) >= WEEK);
    if (!due.length) return { dueQuotations: 0, emails: 0 };
    const refs = due.map(reference);
    const [leads, users] = await Promise.all([
      Lead.find({ $or: [{ _id: { $in: refs.flatMap(ref => ref.ids) } }, { leadCode: { $in: refs.flatMap(ref => ref.codes) } }, { sourceLeadId: { $in: refs.flatMap(ref => ref.codes) } }] }).select(LEAD_FIELDS).lean(),
      User.find({ isActive: { $ne: false } }).select('_id name email role roles isActive crmUserId').lean()
    ]);
    const batches = new Map();let pendingCount = 0;
    for (const quote of due) {
      const lead = leads.find(lead => leadMatches(quote, lead));
      const pending = openServices(quote, lead);
      if (!pending.length) continue;
      pendingCount += pending.length;
      const cycle = Math.floor((+now - +approvalAt(quote)) / WEEK);
      for (const recipient of recipientUsers(quote, lead, pending, users)) {
        const email = recipient.email.trim().toLowerCase();
        const key = `approved-quotation-po:${quote._id}:${+approvalAt(quote)}:${cycle}:${crypto.createHash('sha256').update(email).digest('hex')}`;
        if (!batches.has(email)) batches.set(email, { recipient, entries: [] });
        batches.get(email).entries.push({ quote, pending, key, cycle });
      }
    }
    if (dryRun) return { dryRun: true, dueQuotations: due.length, pendingServices: pendingCount, recipientEmails: batches.size, emails: 0 };
    let emails = 0;let failures = 0;
    for (const { recipient, entries } of batches.values()) {
      const fresh = [];
      for (const candidate of entries) {
        const delivery = await claim(candidate.key, now);
        if (!delivery) continue;
        const entry = { ...candidate, delivery };
        const quote = await Quotation.findById(entry.quote._id).select(QUOTE_FIELDS).lean();
        const lead = quote && approved(quote) ? await findLead(quote) : null;
        const pending = quote && approved(quote) ? openServices(quote, lead) : [];
        const stillDue = quote && approvalAt(quote) && +approvalAt(quote) === +approvalAt(entry.quote) && Math.floor((+now - +approvalAt(quote)) / WEEK) === entry.cycle;
        const stillRecipient = pending.length && recipientUsers(quote, lead, pending, users).some(user => user.email.toLowerCase() === recipient.email.toLowerCase());
        if (stillDue && stillRecipient) fresh.push({ ...entry, quote, pending });
        else await ReminderDelivery.deleteOne({ _id: entry.delivery._id, status: 'sending' });
      }
      if (!fresh.length) continue;
      try {
        const count = fresh.reduce((sum, entry) => sum + entry.pending.length, 0);
        await mailer.sendMail(recipient.email, `Weekly PO follow-up: ${count} service(s) still not closed — approved quotations`, emailHtml(recipient, fresh), { branded: false });
        emails += 1;
        for (const entry of fresh) await ReminderDelivery.updateOne({ _id: entry.delivery._id }, { $set: { status: 'sent', sentAt: now } });
      } catch (error) {
        failures += 1;
        for (const entry of fresh) await ReminderDelivery.updateOne({ _id: entry.delivery._id, status: 'sending' }, { $set: { leaseUntil: new Date(+now + 5 * 60000) } });
        console.warn('Approved quotation PO reminder pending retry', { code: error.code || 'MAIL_FAILED' });
      }
    }
    return { dueQuotations: due.length, pendingServices: pendingCount, emails, failures };
  } finally { running = false; }
}
function startApprovedQuotationPoReminderScheduler() {
  if (started) return;started = true;
  const run = () => runApprovedQuotationPoReminders().catch(error => console.error('Approved quotation PO reminder scan failed', { name: error.name, code: error.code }));
  const first = setTimeout(run, 60000);first.unref?.();
  const timer = setInterval(run, 60 * 60 * 1000);timer.unref?.();
}
module.exports = { runApprovedQuotationPoReminders, startApprovedQuotationPoReminderScheduler, __test: { WEEK, approvalAt, assignmentForItem, itemPoClosed, openServices, recipientUsers, emailHtml } };
