const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Approval = require('../models/PendingApproval');
const Lead = require('../models/Lead');
const Invoice = require('../models/ProformaInvoice');
const User = require('../models/User');
const Delivery = require('../models/ReminderDelivery');
const mailer = require('../utils/mailer');
const { userHasAnyRole } = require('../utils/userRoles');
const DAY = 86400000, TWO_DAYS = 2 * DAY, WEEK = 7 * DAY, IST = 330 * 60000;
const LEASE = 15 * 60000;
const APPROVAL_FIELDS = 'type deletedAt sourceClientId uniqueId clientName approvalStatus actionAt createdByName poReview.adminApproval poReview.stage poReview.finalStatus poReview.terms payload.leadId payload.leadCode payload.assignedServiceId payload.assignmentIndex payload.service payload.poSubmittedById payload.poSubmittedByName payload.poSubmittedByEmail payload.leadCreatorId payload.leadCreatorEmail payload.poYearRows.poNumber payload.poYearRows.poAmount payload.poYearRows.paymentTerm payload.poYearRows.quotationId payload.poYearRows.quotationNumber';
const LEAD_FIELDS = 'company leadCode sourceLeadId createdBy createdByName createdByEmail generatedForUser generatedForName generatedForEmail createdOnBehalfOfUser createdOnBehalfOfEmail assignments.assignedServiceId assignments.serviceAssignmentId assignments.assignedTo assignments.assignedToText assignments.assignedToEmail assignments.poApprovalStatus serviceSelections.assignedServiceId serviceSelections.serviceAssignmentId serviceSelections.servicesOffered';
const INVOICE_FIELDS = 'status quotationId quotationNumber leadRef leadId leadCode poNumber poYearRows.poNumber items.assignedServiceId items.sourceItemIndex emailHistory.to emailHistory.sentAt';
let running = false, started = false;
const text = value => String(value?._id || value || '').trim();
const sid = row => text(row?.assignedServiceId || row?.serviceAssignmentId);
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function approvalAt(row) {
  const value = row.poReview?.adminApproval?.at || (row.approvalStatus === 'APPROVED' ? row.actionAt : null);
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(+date) ? date : null;
}
function eligible(row) {
  return !row.deletedAt && !['REJECTED', 'REVISION_REQUIRED'].includes(row.approvalStatus)
    && !['REJECTED', 'REVISION_REQUIRED'].includes(row.poReview?.finalStatus) && Boolean(approvalAt(row));
}
function leadFor(approval, leads) {
  const ids = [text(approval.payload?.leadId), text(approval.sourceClientId).split(':po:')[0]].filter(Boolean);
  return leads.find(lead => ids.includes(text(lead._id)) || [approval.payload?.leadCode, approval.uniqueId, ...ids].filter(Boolean).some(value => [lead.leadCode, lead.sourceLeadId].includes(value)));
}
function assignmentFor(approval, lead) {
  const id = text(approval.payload?.assignedServiceId || sid(approval.payload?.service));
  const assignments = lead.assignments || [];
  if (id) {
    const exact = assignments.find(row => sid(row) === id);
    if (exact) return exact;
    const index = (lead.serviceSelections || []).findIndex(row => sid(row) === id);
    return index >= 0 && !sid(assignments[index]) ? assignments[index] : null;
  }
  const index = approval.payload?.assignmentIndex;
  if (Number.isInteger(index) && assignments[index]) return assignments[index];
  return assignments.length === 1 ? assignments[0] : null;
}
function recipients(approval, lead, users) {
  const owner = lead.generatedForUser || lead.createdOnBehalfOfUser || lead.createdBy;
  const tokens = [owner, lead.generatedForEmail, lead.createdOnBehalfOfEmail, lead.createdByEmail, approval.payload?.poSubmittedById, approval.payload?.poSubmittedByEmail, approval.payload?.leadCreatorId, approval.payload?.leadCreatorEmail].map(value => text(value).toLowerCase()).filter(Boolean);
  const names = [lead.generatedForName, lead.createdByName, approval.payload?.poSubmittedByName, approval.createdByName].map(value => text(value).toLowerCase()).filter(Boolean);
  return users.filter(user => user.isActive !== false && validEmail(user.email) && (
    userHasAnyRole(user, ['admin', 'superadmin'])
    || [user._id, user.email, user.crmUserId].some(value => tokens.includes(text(value).toLowerCase()))
    || names.some(name => name === text(user.name).toLowerCase() && users.filter(other => text(other.name).toLowerCase() === name).length === 1)
  )).filter((user, index, rows) => rows.findIndex(other => other.email.toLowerCase() === user.email.toLowerCase()) === index);
}
function invoiceSent(approval, lead, invoice, users) {
  if (invoice.status === 'cancelled') return false;
  const internal = new Set(users.map(user => text(user.email).toLowerCase()).filter(Boolean));
  if (!(invoice.emailHistory || []).some(entry => entry.sentAt && (entry.to || []).some(email => validEmail(email) && !internal.has(text(email).toLowerCase())))) return false;
  const pos = approval.payload?.poYearRows || [];
  const sameQuote = pos.some(po => po.quotationId && text(po.quotationId) === text(invoice.quotationId));
  const sameLead = [invoice.leadRef, invoice.leadId, invoice.leadCode].map(text).some(value => value && [text(lead._id), lead.leadCode, lead.sourceLeadId].includes(value));
  if (!sameLead && !sameQuote) return false;
  const id = text(approval.payload?.assignedServiceId || sid(approval.payload?.service));
  if (id) {
    if ((invoice.items || []).some(item => text(item.assignedServiceId) === id)) return true;
    // A populated but different service identity must never complete a sibling.
    if ((invoice.items || []).some(item => text(item.assignedServiceId))) return false;
  }
  const poNumbers = pos.map(row => text(row.poNumber)).filter(Boolean);
  const samePo = [invoice.poNumber, ...(invoice.poYearRows || []).map(row => row.poNumber)].some(value => value && poNumbers.includes(value));
  if (!samePo) return false;
  const index = (lead.serviceSelections || []).findIndex(row => id && sid(row) === id);
  if (index >= 0 && (invoice.items || []).some(item => item.sourceItemIndex === index)) return true;
  return (lead.serviceSelections || []).length <= 1 && (lead.assignments || []).length <= 1;
}
function tasksFor(approval, leads, invoices, users, now) {
  if (!eligible(approval) || +approvalAt(approval) > +now) return null;
  const lead = leadFor(approval, leads);
  if (!lead) return null;
  const assignment = assignmentFor(approval, lead);
  if (!assignment || ['REJECTED', 'REVISION_REQUIRED'].includes(assignment.poApprovalStatus)) return null;
  const tasks = [];
  if (!text(assignment.assignedTo) && !text(assignment.assignedToEmail) && !text(assignment.assignedToText)) tasks.push('manager');
  if (!invoices.some(invoice => invoiceSent(approval, lead, invoice, users))) tasks.push('pi');
  return { approval, lead, tasks, recipients: recipients(approval, lead, users), approvedAt: approvalAt(approval) };
}
function weekKey(now) {
  const local = new Date(+now + IST);
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  return +local >= monday + 9 * 3600000 ? String(monday) : '';
}
function htmlFor(recipient, entries, task = 'weekly', now = new Date()) {
  const weekly = task === 'weekly';
  const title = weekly ? 'Weekly pending PO actions' : task === 'manager' ? 'Assign a manager for the approved PO' : 'Send the Proforma Invoice to your client';
  const managerCount = entries.filter(entry => entry.tasks.includes('manager')).length;
  const piCount = entries.filter(entry => entry.tasks.includes('pi')).length;
  const leadCount = new Set(entries.map(entry => text(entry.lead._id))).size;
  const cells = entries.map(({ approval, lead, tasks, approvedAt }) => {
    const terms = (approval.poReview?.terms || approval.payload?.poYearRows || []).map(row => [row.paymentTerm, ...(row.customTerms || [])].filter(Boolean).join('; ')).filter(Boolean).join(' | ') || 'Review the agreed PO / quotation payment terms before preparing the PI.';
    return `<tr>${[lead.company || approval.clientName, lead.leadCode || approval.uniqueId, approval.payload?.service?.servicesOffered || 'Service', (approval.payload?.poYearRows || []).map(row => row.poNumber).filter(Boolean).join(', '), tasks.map(value => value === 'manager' ? 'Manager assignment pending' : 'PI not emailed to client').join(' · '), terms, approvedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })].map(value => `<td style="padding:12px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top">${esc(value)}</td>`).join('')}</tr>`;
  }).join('');
  let origin = 'https://crmananttattva.com';
  try { origin = new URL(process.env.APP_URL || process.env.FRONTEND_URL || origin).origin; } catch {}
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 12px" align="center"><table role="presentation" width="100%" style="max-width:1100px;border:1px solid #dbe5e9;border-radius:16px;background:white;overflow:hidden" cellpadding="0" cellspacing="0"><tr><td style="padding:28px;background:#0f766e;color:white"><small>ANANTTATTVA CRM · ${weekly ? 'WEEKLY PENDING LIST' : 'APPROVED PO ACTION'}</small><h1 style="font-size:24px;margin:12px 0 0">${title}</h1></td></tr><tr><td style="padding:24px"><p>Hello ${esc(recipient.name || recipient.email)},</p><p>${weekly ? 'The following actions remain incomplete for approved Purchase Orders.' : task === 'manager' ? 'Admin has approved the PO. Please assign the responsible manager in Lead Generation.' : 'Admin has approved the PO. Prepare the PI according to the agreed payment terms, then use Send Email to deliver it to the client.'}</p><table role="presentation" width="100%" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px"><tr><td style="padding:14px"><strong>${leadCount}</strong> leads</td><td style="padding:14px"><strong>${managerCount}</strong> manager assignments pending</td><td style="padding:14px"><strong>${piCount}</strong> PIs not sent</td></tr></table><table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;font-size:12px;border:1px solid #e2e8f0;border-collapse:collapse"><thead style="background:#f8fafc"><tr>${['Company','Lead','Service','PO','Pending action','Payment terms','Admin approved'].map(label => `<th align="left" style="padding:12px 10px">${label}</th>`).join('')}</tr></thead><tbody>${cells}</tbody></table><p style="font-size:12px;line-height:1.7;color:#64748b">Manager-assignment reminders stop after assignment. PI reminders stop after the related invoice is emailed to an external client. Manager-assignment reminders repeat every 2 days. PI-not-sent reminders repeat every 7 days; a consolidated list is sent weekly. A generated but unsent PI remains pending.</p><a href="${esc(origin)}/sales/lead-generation" style="display:inline-block;margin:8px 10px 8px 0;padding:12px 18px;background:#0f766e;color:white;border-radius:8px;text-decoration:none">Assign manager</a><a href="${esc(origin)}/sales/proforma-invoices" style="display:inline-block;margin:8px 0;padding:12px 18px;background:#1e293b;color:white;border-radius:8px;text-decoration:none">Prepare & send PI</a><p style="font-size:11px;color:#64748b">Updated ${esc(now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST</p></td></tr></table></td></tr></table></body></html>`;
}
async function claim(key, now) {
  try { return await Delivery.create({ key, status: 'sending', leaseUntil: new Date(+now + LEASE) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    return Delivery.findOneAndUpdate({ key, status: 'sending', leaseUntil: { $lte: now } }, { $set: { leaseUntil: new Date(+now + LEASE) }, $inc: { attempts: 1 } }, { new: true });
  }
}
async function loadEntries({ approvalId, now }) {
  const approvals = await Approval.find({ type: 'purchase_order', deletedAt: null, ...(approvalId ? { _id: approvalId } : {}), approvalStatus: { $nin: ['REJECTED', 'REVISION_REQUIRED'] }, $or: [{ 'poReview.adminApproval.at': { $exists: true } }, { approvalStatus: 'APPROVED' }] }).select(APPROVAL_FIELDS).lean();
  if (!approvals.length) return [];
  const ids = approvals.flatMap(row => [text(row.payload?.leadId), text(row.sourceClientId).split(':po:')[0]]).filter(value => mongoose.isValidObjectId(value));
  const codes = approvals.flatMap(row => [row.payload?.leadCode, row.uniqueId, text(row.payload?.leadId)]).filter(Boolean);
  const quoteIds = approvals.flatMap(row => (row.payload?.poYearRows || []).map(po => po.quotationId)).filter(value => mongoose.isValidObjectId(text(value)));
  const quoteNumbers = approvals.flatMap(row => (row.payload?.poYearRows || []).map(po => po.quotationNumber)).filter(Boolean);
  const [leads, invoices, users] = await Promise.all([
    Lead.find({ $or: [{ _id: { $in: ids } }, { leadCode: { $in: codes } }, { sourceLeadId: { $in: codes } }] }).select(LEAD_FIELDS).lean(),
    Invoice.find({ status: { $ne: 'cancelled' }, 'emailHistory.0': { $exists: true }, $or: [{ leadRef: { $in: ids } }, { leadId: { $in: [...ids, ...codes] } }, { leadCode: { $in: codes } }, { quotationId: { $in: quoteIds } }, { quotationNumber: { $in: quoteNumbers } }] }).select(INVOICE_FIELDS).lean(),
    User.find({ isActive: { $ne: false } }).select('_id name email role roles isActive crmUserId').lean()
  ]);
  return approvals.map(approval => tasksFor(approval, leads, invoices, users, now)).filter(entry => entry?.tasks.length);
}
async function sendClaimed({ key, recipient, entries, task, now, stats, refresh }) {
  const claimed = await claim(key, now);
  if (!claimed) return;
  try {
    const current = await refresh();
    const fresh = entries.map(entry => current.find(value => text(value.approval._id) === text(entry.approval._id) && +value.approvedAt === +entry.approvedAt && (task === 'weekly' || value.tasks.includes(task)) && value.recipients.some(user => user.email.toLowerCase() === recipient.email.toLowerCase()))).filter(Boolean);
    if (!fresh.length) { await Delivery.deleteOne({ _id: claimed._id, status: 'sending' }); return; }
    const subject = task === 'weekly' ? `Weekly pending PO actions: ${new Set(fresh.map(entry => text(entry.lead._id))).size} leads · ${fresh.reduce((sum, entry) => sum + entry.tasks.length, 0)} actions` : `${task === 'manager' ? 'Assign manager' : 'Send PI to client'} — ${fresh[0].lead.leadCode || fresh[0].approval.uniqueId} · ${fresh[0].lead.company || fresh[0].approval.clientName}`;
    const result = await mailer.sendMail(recipient.email, subject, htmlFor(recipient, fresh, task, now), { branded: false });
    if (result?.summary?.rejected?.length) throw Object.assign(new Error('Recipient rejected'), { code: 'MAIL_REJECTED' });
    await Delivery.updateOne({ _id: claimed._id }, { $set: { status: 'sent', sentAt: now } });
    stats.emails++;
  } catch (error) {
    await Delivery.updateOne({ _id: claimed._id, status: 'sending' }, { $set: { leaseUntil: new Date(+now + 5 * 60000) } });
    stats.failures++;
    console.warn('Post-approval action email pending retry', { code: error.code || 'MAIL_FAILED' });
  }
}
async function runPostPoApprovalReminders({ now = new Date(), approvalId, dryRun = false } = {}) {
  if (!approvalId && running) return { skipped: true };
  if (!approvalId) running = true;
  try {
    const entries = await loadEntries({ approvalId, now });
    const stats = { pendingLeads: new Set(entries.map(entry => text(entry.lead._id))).size, managerPending: entries.filter(entry => entry.tasks.includes('manager')).length, piPending: entries.filter(entry => entry.tasks.includes('pi')).length, emails: 0, failures: 0 };
    if (dryRun) return { ...stats, dryRun: true };
    // Recheck the source after each delivery claim; never mail a completed or revoked task.
    const jobs = [];
    for (const entry of entries) for (const task of entry.tasks) for (const recipient of entry.recipients) {
      const interval = task === 'pi' ? WEEK : TWO_DAYS;
      const cycle = Math.floor((+now - +entry.approvedAt) / interval);
      const hash = crypto.createHash('sha256').update(recipient.email.toLowerCase()).digest('hex');
      jobs.push(async () => {
        if (task === 'pi') {
          // Include old two-day deliveries when switching cadence, so deployment
          // does not immediately resend a recently delivered PI reminder.
          const escapedId = text(entry.approval._id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const latest = await Delivery.findOne({ key: new RegExp(`^post-po:${escapedId}:${+entry.approvedAt}:pi(?:-weekly)?:\\d+:${hash}$`), status: 'sent' }).sort({ sentAt: -1 }).select('sentAt').lean();
          if (latest?.sentAt && +now - +new Date(latest.sentAt) < WEEK) return;
        }
        const keyTask = task === 'pi' ? 'pi-weekly' : task;
        await sendClaimed({ key: `post-po:${entry.approval._id}:${+entry.approvedAt}:${keyTask}:${cycle}:${hash}`, recipient, entries: [entry], task, now, stats, refresh: () => loadEntries({ approvalId: entry.approval._id, now }) });
      });
    }
    let nextJob = 0;
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (nextJob < jobs.length) { const job = jobs[nextJob++]; await job(); }
    }));
    const week = !approvalId && weekKey(now);
    if (week) {
      const batches = new Map();
      for (const entry of entries) for (const recipient of entry.recipients) {
        const email = recipient.email.toLowerCase();
        if (!batches.has(email)) batches.set(email, { recipient, entries: [] });
        batches.get(email).entries.push(entry);
      }
      for (const batch of batches.values()) {
        const hash = crypto.createHash('sha256').update(batch.recipient.email.toLowerCase()).digest('hex');
        await sendClaimed({ key: `post-po-weekly:${week}:${hash}`, ...batch, task: 'weekly', now, stats, refresh: () => loadEntries({ now }) });
      }
    }
    return stats;
  } finally { if (!approvalId) running = false; }
}
function startPostPoApprovalReminderScheduler() {
  if (started) return;
  started = true;
  const run = () => runPostPoApprovalReminders().catch(error => console.error('Post-PO approval reminder scan failed', { name: error.name, code: error.code }));
  const first = setTimeout(run, 60000); first.unref?.();
  const timer = setInterval(run, 15 * 60000); timer.unref?.();
}
module.exports = { runPostPoApprovalReminders, startPostPoApprovalReminderScheduler, __test: { TWO_DAYS, WEEK, weekKey, tasksFor, invoiceSent, recipients, htmlFor, assignmentFor } };
