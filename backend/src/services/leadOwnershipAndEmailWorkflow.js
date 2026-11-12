const { isValidObjectId } = require('mongoose');
const { createHash } = require('crypto');
const Lead = require('../models/Lead');
const TemporaryLead = require('../models/TemporaryLead');
const User = require('../models/User');
const ReminderDelivery = require('../models/ReminderDelivery');
const LeadActivity = require('../models/LeadActivity');
const mailer = require('../utils/mailer');
const { buildCompanySignature, getIntroductionLogoAttachment } = require('./leadIntroductionEmail');
const { escapeHtml } = require('./quotationDelivery');
const { userHasAnyRole } = require('../utils/userRoles');
const DAY = 86400000;
const missingEmail = { email: { $in: [null, ''] }, status: 'DRAFT', pipelineClosedAt: null };
let running = null;
let ownershipRunning = null;
let started = false;

function hasClosure(row) {
  return Boolean(row.closedAt || row.closedBy || row.closedByText || /closed|won|converted|lost|cancel/i.test(row.status || '') || /inactive|deleted/i.test(row.recordStatus || '') || row.poStatus === 'provisional' || row.poStatus === 'permanently_closed' || (row.poYearRows || []).some(po => po.poNumber || po.poNo));
}
function lastLeadActivityAt(lead) {
  const timestamps = [lead.createdAt, lead.updatedAt, lead.noOwner?.reassignedAt]
    .map(value => new Date(value).getTime())
    .filter(Number.isFinite);
  return timestamps.length ? Math.max(...timestamps) : NaN;
}
function eligibleForNoOwner(lead, now = Date.now()) {
  const since = lastLeadActivityAt(lead);
  return !lead.noOwner?.active && Number.isFinite(since) && now - since >= 30 * DAY && !hasClosure(lead) && !(lead.serviceSelections || []).some(hasClosure) && !(lead.assignments || []).some(hasClosure);
}
function previousOwner(lead) {
  return {
    id: lead.generatedForUser || lead.createdBy || lead.assignedStaff || lead.assignedTo,
    name: lead.generatedForName || lead.createdByName || lead.importedCreatedBy || lead.assignedStaffText || lead.assignedToText || 'Unassigned',
    email: lead.generatedForEmail || lead.createdByEmail || lead.assignedStaffEmail || lead.assignedToEmail || '',
    createdBy: lead.createdBy, generatedForUser: lead.generatedForUser,
    assignments: (lead.assignments || []).map(row => ({ assignedTo: row.assignedTo, assignedToText: row.assignedToText, assignedStaff: row.assignedStaff, assignedStaffText: row.assignedStaffText }))
  };
}
function noOwnerUpdate(lead, now) {
  const set = { 'noOwner.active': true, 'noOwner.movedAt': new Date(now), 'noOwner.previousOwner': previousOwner(lead), 'noOwner.notifiedAt': null };
  for (const key of ['createdBy', 'generatedForUser', 'assignedTo', 'assignedStaff', 'secondaryCreatedBy', 'createdOnBehalfOfUser']) set[key] = null;
  for (const key of ['createdByName', 'createdByEmail', 'createdByCrmUserId', 'importedCreatedBy', 'generatedForName', 'generatedForEmail', 'assignedToText', 'assignedToEmail', 'assignedStaffText', 'assignedStaffEmail', 'assignedBy', 'secondaryCreatedByName', 'secondaryCreatedByEmail', 'secondaryCreatedByCrmUserId', 'createdOnBehalfOfName', 'createdOnBehalfOfEmail']) set[key] = '';
  if (lead.assignments?.length) {
    for (const key of ['assignedTo', 'assignedStaff']) set[`assignments.$[].${key}`] = null;
    for (const key of ['assignedToText', 'assignedStaffText', 'assignedToEmail', 'assignedStaffEmail', 'assignedBy', 'assignedToCrmUserId', 'assignedStaffCrmUserId']) set[`assignments.$[].${key}`] = '';
  }
  return { $set: set };
}
function eventEmail({ label, title, description, fields, color = '#0f766e', tab = 'no-owner' }) {
  const url = `${String(process.env.PUBLIC_URL || 'https://crmananttattva.com').replace(/\/$/, '')}/sales/lead-generation?tab=${tab}`;
  return `<div style="background:#f1f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:720px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden"><div style="background:${color};padding:26px 30px;color:#fff"><p style="margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:2px">${escapeHtml(label)}</p><h1 style="margin:0;font-size:26px">${escapeHtml(title)}</h1></div><div style="padding:28px 30px"><p style="font-size:15px;line-height:1.7">${escapeHtml(description)}</p><table style="width:100%;border-collapse:collapse">${Object.entries(fields).map(([key, value]) => `<tr><th align="left" style="padding:12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:12px">${escapeHtml(key)}</th><td style="padding:12px;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700">${escapeHtml(value)}</td></tr>`).join('')}</table><a href="${escapeHtml(url)}" style="display:inline-block;margin-top:24px;padding:13px 22px;background:${color};border-radius:9px;color:#fff;text-decoration:none;font-weight:700">Open CRM workspace</a>${buildCompanySignature()}</div></div></div>`;
}
function noOwnerSummaryEmail(rows) {
  const url = `${String(process.env.PUBLIC_URL || 'https://crmananttattva.com').replace(/\/$/, '')}/sales/lead-generation?tab=no-owner`;
  const tableRows = rows.map((lead, index) => {
    const owner = lead.noOwner?.previousOwner || {};
    const movedAt = lead.noOwner?.movedAt
      ? new Date(lead.noOwner.movedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : '-';
    return `<tr><td style="padding:11px 9px;border-bottom:1px solid #e2e8f0;font-size:12px">${index + 1}</td><td style="padding:11px 9px;border-bottom:1px solid #e2e8f0;font-size:12px;font-weight:700">${escapeHtml(lead.leadCode || lead._id)}</td><td style="padding:11px 9px;border-bottom:1px solid #e2e8f0;font-size:12px">${escapeHtml(lead.company || '-')}</td><td style="padding:11px 9px;border-bottom:1px solid #e2e8f0;font-size:12px">${escapeHtml(owner.name || 'Unassigned')}</td><td style="padding:11px 9px;border-bottom:1px solid #e2e8f0;font-size:12px;white-space:nowrap">${escapeHtml(movedAt)}</td></tr>`;
  }).join('');
  return `<div style="background:#fff7ed;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:920px;margin:auto;background:#fff;border:1px solid #fed7aa;border-radius:18px;overflow:hidden"><div style="background:#c2410c;padding:26px 30px;color:#fff"><p style="margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:2px">OWNERSHIP RELEASED · 30-DAY INACTIVITY</p><h1 style="margin:0;font-size:26px">No Owner Leads summary</h1><p style="margin:10px 0 0;font-size:14px;line-height:1.6">${rows.length} open lead${rows.length === 1 ? ' has' : 's have'} had no activity for 30 days and ${rows.length === 1 ? 'is' : 'are'} now available in the shared lead pool.</p></div><div style="padding:24px 30px"><table style="width:100%;border-collapse:collapse"><thead><tr>${['#', 'Lead', 'Company', 'Previous owner', 'Released at (IST)'].map(label => `<th align="left" style="padding:11px 9px;background:#f8fafc;border-bottom:1px solid #cbd5e1;color:#64748b;font-size:10px;text-transform:uppercase">${label}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table><a href="${escapeHtml(url)}" style="display:inline-block;margin-top:24px;padding:13px 22px;background:#c2410c;border-radius:9px;color:#fff;text-decoration:none;font-weight:700">Open No Owner Leads</a>${buildCompanySignature()}</div></div></div>`;
}
async function sendOnce(key, email, subject, html, now, beforeSend) {
  let claim;
  try { claim = await ReminderDelivery.create({ key, status: 'sending', leaseUntil: new Date(now + 15 * 60000) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await ReminderDelivery.findOne({ key }).lean();
    if (existing?.status === 'sent') return true;
    claim = await ReminderDelivery.findOneAndUpdate({ key, status: 'sending', leaseUntil: { $lte: new Date(now) } }, { $set: { leaseUntil: new Date(now + 15 * 60000) }, $inc: { attempts: 1 } }, { new: true });
    if (!claim) return false;
  }
  try {
    if (beforeSend && !(await beforeSend())) { await ReminderDelivery.deleteOne({ key, status: 'sending' }); return false; }
    await mailer.sendMail(email, subject, html, { branded: false, attachments: [getIntroductionLogoAttachment()] });
    await ReminderDelivery.updateOne({ _id: claim._id }, { $set: { status: 'sent', sentAt: new Date(now) } });
    return true;
  } catch (error) {
    await ReminderDelivery.updateOne({ _id: claim._id, status: 'sending' }, { $set: { leaseUntil: new Date(now + 5 * 60000) } });
    console.warn('Lead workflow email pending retry', { key, code: error.code || 'MAIL_FAILED' });
    return false;
  }
}
async function moveOldOpenLeads(now) {
  const cutoff = new Date(now - 30 * DAY);
  const closedRow = { $or: [
    ...['closedAt', 'closedBy', 'closedByText', 'poYearRows.poNumber', 'poYearRows.poNo'].map(field => ({ [field]: { $exists: true, $nin: [null, ''] } })),
    { status: /closed|won|converted|lost|cancel/i },
    { recordStatus: /inactive|deleted/i },
    { poStatus: { $in: ['provisional', 'permanently_closed'] } }
  ] };
  const candidates = await Lead.find({
    createdAt: { $lte: cutoff }, 'noOwner.active': { $ne: true },
    $and: [
      { $or: [{ updatedAt: null }, { updatedAt: { $lte: cutoff } }] },
      { $or: [{ 'noOwner.reassignedAt': null }, { 'noOwner.reassignedAt': { $lte: cutoff } }] }
    ],
    recordStatus: { $not: /inactive|deleted/i },
    closedAt: null, closedBy: null, closedByText: { $in: [null, ''] },
    status: { $not: /closed|won|converted|lost|cancel/i },
    poStatus: { $nin: ['provisional', 'permanently_closed'] },
    assignments: { $not: { $elemMatch: closedRow } },
    serviceSelections: { $not: { $elemMatch: closedRow } }
  }).select('createdAt updatedAt status recordStatus noOwner createdBy createdByName createdByEmail generatedForUser generatedForName generatedForEmail assignedStaff assignedStaffText assignedStaffEmail assignedTo assignedToText assignedToEmail importedCreatedBy closedAt closedBy closedByText poStatus serviceSelections.closedAt serviceSelections.closedBy serviceSelections.closedByText serviceSelections.status assignments.assignedTo assignments.assignedToText assignments.assignedStaff assignments.assignedStaffText assignments.closedAt assignments.closedBy assignments.closedByText assignments.status assignments.poStatus assignments.poYearRows.poNumber assignments.poYearRows.poNo').sort({ updatedAt: 1, createdAt: 1 }).limit(100).maxTimeMS(15000).lean();
  let moved = 0;
  for (const lead of candidates) {
    if (!eligibleForNoOwner(lead, now)) continue;
    const update = noOwnerUpdate(lead, now);
    const owner = update.$set['noOwner.previousOwner'];
    if (owner.id && isValidObjectId(owner.id)) {
      const account = await User.findById(owner.id).select('name email').lean();
      if (account) { owner.name = account.name || account.email; owner.email = account.email; }
    }
    const result = await Lead.findOneAndUpdate({ _id: lead._id, updatedAt: lead.updatedAt || null, 'noOwner.active': { $ne: true } }, update, { new: true });
    if (!result) continue;
    moved++;
    await LeadActivity.create({ lead: lead._id, type: 'no_owner', title: 'Moved to No Owner Leads', description: `No lead activity for 30 days. Previous owner: ${owner.name}. Ownership released automatically.`, actorName: 'CRM automation', metadata: { previousOwner: owner, lastActivityAt: new Date(lastLeadActivityAt(lead)) } });
  }
  return moved;
}
async function notifyNoOwnerLeads(now) {
  const rows = await Lead.find({ 'noOwner.movedAt': { $ne: null }, 'noOwner.notifiedAt': null }).select('leadCode company noOwner').sort({ 'noOwner.movedAt': 1 }).limit(100).maxTimeMS(15000).lean();
  if (!rows.length) return;
  const users = await User.find({ isActive: { $ne: false }, email: { $exists: true, $ne: '' } }).select('name email role roles').lean();
  const emails = [...new Set(users.filter(user => userHasAnyRole(user, ['admin', 'superadmin'])).map(user => String(user.email || '').trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return;
  const batchId = createHash('sha256').update(rows.map(lead => `${lead._id}:${new Date(lead.noOwner.movedAt).getTime()}`).join('|')).digest('hex').slice(0, 24);
  const html = noOwnerSummaryEmail(rows);
  const results = await Promise.all(emails.map(email => sendOnce(`no-owner-summary:${batchId}:${email}`, email, `No Owner Leads summary: ${rows.length} lead${rows.length === 1 ? '' : 's'} released`, html, now)));
  if (results.every(Boolean)) {
    for (const lead of rows) {
      await Lead.updateOne({ _id: lead._id, 'noOwner.movedAt': lead.noOwner.movedAt, 'noOwner.notifiedAt': null }, { $set: { 'noOwner.notifiedAt': new Date(now) } });
    }
  }
}
async function refreshNoOwnerLeads(now = Date.now()) {
  if (ownershipRunning) return ownershipRunning;
  ownershipRunning = (async () => {
    const moved = await moveOldOpenLeads(now);
    if (moved) await require('./crmCache').invalidateCrmCache();
    let notificationPending = false;
    try {
      await notifyNoOwnerLeads(now);
    } catch (error) {
      // Email delivery and recipient lookup must never prevent the shared lead
      // directory from loading. The scheduler retries pending summaries.
      notificationPending = true;
      console.error('No Owner Leads summary notification failed', { name: error.name, message: error.message });
    }
    return { moved, notificationPending };
  })();
  try {
    return await ownershipRunning;
  } finally {
    ownershipRunning = null;
  }
}
async function remindMissingTemporaryEmails(now) {
  let changed = false;
  const rows = await TemporaryLead.find({ ...missingEmail, createdAt: { $lte: new Date(now - 2 * DAY) }, $and: [{ $or: [{ emailReminderSentAt: null }, { emailRedFlagAt: null, emailGraceExpiresAt: { $lte: new Date(now) } }] }, { $or: [{ emailWorkflowRetryAt: null }, { emailWorkflowRetryAt: { $lte: new Date(now) } }] }] }).sort({ createdAt: 1 }).limit(100).maxTimeMS(15000).lean();
  for (const row of rows) {
    if (!row.emailReminderSentAt) {
      const owner = await User.findById(row.createdBy).select('name email isActive').lean();
      if (!owner?.email || !owner.isActive) {
        await TemporaryLead.updateOne({ _id: row._id, ...missingEmail }, { $set: { emailWorkflowRetryAt: new Date(now + DAY) } });
        continue;
      }
      const html = eventEmail({ label: 'ACTION REQUIRED · CLIENT EMAIL MISSING', title: 'Please add the client email', description: `Hello ${owner.name || 'team member'}, this temporary lead has no client email after 48 hours. Please add it within 24 hours of this reminder to avoid a red flag.`, fields: { Lead: row.tempLeadCode, Company: row.clientName, Owner: owner.name, 'Created at (IST)': new Date(row.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), 'Next step': 'Open the cold lead, choose Edit, and enter the client email.' }, color: '#b45309', tab: 'temporary' });
      const sent = await sendOnce(`temporary-missing-email:${row._id}`, owner.email, `Client email required: ${row.tempLeadCode}`, html, now, () => TemporaryLead.exists({ _id: row._id, ...missingEmail, createdBy: row.createdBy }));
      if (sent) {
        changed = true;
        const receipt = await ReminderDelivery.findOne({ key: `temporary-missing-email:${row._id}`, status: 'sent' }).lean();
        const sentAt = receipt?.sentAt || new Date(now);
        await TemporaryLead.updateOne({ _id: row._id, ...missingEmail, emailReminderSentAt: null }, { $set: { emailReminderSentAt: sentAt, emailGraceExpiresAt: new Date(new Date(sentAt).getTime() + DAY) } });
      } else {
        await TemporaryLead.updateOne({ _id: row._id, ...missingEmail }, { $set: { emailWorkflowRetryAt: new Date(now + 5 * 60000) } });
      }
    } else if (!row.emailRedFlagAt && new Date(row.emailGraceExpiresAt || new Date(row.emailReminderSentAt).getTime() + DAY).getTime() <= now) {
      changed = true;
      await TemporaryLead.updateOne({ _id: row._id, ...missingEmail, emailRedFlagAt: null }, { $set: { emailRedFlagAt: new Date(now) } });
    }
  }
  return changed;
}
async function runLeadOwnershipAndEmailWorkflow(now = Date.now()) {
  // Join an in-progress scan instead of returning early. The No Owner tab also
  // invokes this workflow before reading, so it must wait for a scheduler scan
  // that may already be moving eligible leads.
  if (running) return running;
  running = (async () => {
    const ownership = await refreshNoOwnerLeads(now);
    const temporaryChanged = await remindMissingTemporaryEmails(now);
    if (temporaryChanged) await require('./crmCache').invalidateCrmCache();
    return ownership;
  })();
  try {
    return await running;
  } finally { running = null; }
}
function startLeadOwnershipAndEmailScheduler() {
  if (started) return;
  started = true;
  const run = () => runLeadOwnershipAndEmailWorkflow().catch(error => console.error('Lead ownership/email workflow failed', { name: error.name, message: error.message }));
  setTimeout(run, 15000);
  setInterval(run, 60000);
}
module.exports = { refreshNoOwnerLeads, runLeadOwnershipAndEmailWorkflow, startLeadOwnershipAndEmailScheduler, __test: { DAY, lastLeadActivityAt, eligibleForNoOwner, noOwnerUpdate, eventEmail, noOwnerSummaryEmail, moveOldOpenLeads, notifyNoOwnerLeads, remindMissingTemporaryEmails, sendOnce } };
