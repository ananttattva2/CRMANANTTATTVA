const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const TemporaryLead = require('../models/TemporaryLead');
const Notification = require('../models/Notification');
const ReminderDelivery = require('../models/ReminderDelivery');
const PendingApproval = require('../models/PendingApproval');
const Quotation = require('../models/Quotation');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { ADMIN_ROLES } = require('../constants/roles');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const THIRTY_MINUTES = 30 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const ONE_WEEK = 7 * DAY;
let started = false;
let running = false;

// This scan runs every minute. Proof PDFs and attachments can be megabytes per
// lead; loading them here stalls the shared API process even on unrelated pages.
const LEAD_REMINDER_PROJECTION = [
  '_id', 'sourceLeadId', 'leadCode', 'company', 'createdAt', 'updatedAt',
  'importedCreatedAt', 'importedUpdatedAt', 'importedCreatedBy', 'bulkImported',
  'createdByCrmUserId', 'createdByEmail', 'createdByName', 'assignedTo', 'assignedStaff',
  'assignedToEmail', 'assignedStaffEmail', 'closedAt', 'closedBy', 'closedByText',
  'nextFollowUpDate', 'nextFollowUpTime', 'followUpPriority', 'servicesOffered',
  'firstAnnualReturnYearApplicable',
  ...['createdByCrmUserId', 'createdByEmail', 'createdByName', 'assignedTo', 'assignedStaff',
    'assignedToEmail', 'assignedStaffEmail', 'closedAt', 'closedBy', 'closedByText',
    'followUpClosedAt', 'nextFollowUpDate', 'nextFollowUpTime', 'followUpPriority',
    'servicesOffered', 'applicableService'].map((field) => `serviceSelections.${field}`),
  ...['assignedTo', 'assignedStaff', 'assignedToEmail', 'assignedStaffEmail',
    'closedAt', 'closedBy', 'closedByText'].map((field) => `assignments.${field}`)
].join(' ');

async function claimReminderDelivery(key, now = Date.now()) {
  const leaseUntil = new Date(Number(now) + (15 * 60 * 1000));
  try {
    return await ReminderDelivery.create({ key, status: 'sending', leaseUntil });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return ReminderDelivery.findOneAndUpdate(
      { key, status: 'sending', leaseUntil: { $lte: new Date(now) } },
      { $set: { leaseUntil }, $inc: { attempts: 1 } },
      { new: true }
    );
  }
}

async function completeReminderDelivery(key, sent) {
  if (sent) return ReminderDelivery.updateOne({ key }, { $set: { status: 'sent', sentAt: new Date(), leaseUntil: new Date() } });
  return ReminderDelivery.deleteOne({ key, status: 'sending' });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function buildFollowUpReminderEmail({ company, description, date, time, priority, isRedFlag }) {
  const accent = isRedFlag ? '#dc2626' : '#0f766e';
  const accentSoft = isRedFlag ? '#fef2f2' : '#f0fdfa';
  const accentBorder = isRedFlag ? '#fecaca' : '#99f6e4';
  const title = isRedFlag ? 'Lead follow-up overdue' : 'Upcoming lead follow-up';
  const eyebrow = isRedFlag ? 'ACTION REQUIRED' : 'FOLLOW-UP REMINDER';
  const safeCompany = escapeHtml(company);
  const safeDescription = escapeHtml(description);
  const safeSchedule = `${escapeHtml(date)}${time ? ` &nbsp;&bull;&nbsp; ${escapeHtml(time)}` : ''}`;
  const safePriority = escapeHtml(priority || 'Medium');

  return `
    <div style="margin:0;padding:32px 16px;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td align="center">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
              <tr>
                <td style="height:6px;background-color:${accent};font-size:0;line-height:0;">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding:34px 36px 22px;">
                  <span style="display:inline-block;padding:6px 10px;border:1px solid ${accentBorder};border-radius:999px;background-color:${accentSoft};color:${accent};font-size:11px;font-weight:700;letter-spacing:1px;">${eyebrow}</span>
                  <h1 style="margin:18px 0 8px;color:#0f172a;font-size:28px;line-height:36px;font-weight:700;">${title}</h1>
                  <p style="margin:0;color:#64748b;font-size:15px;line-height:24px;">A quick reminder from your CRM workspace</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0 36px 28px;">
                  <div style="padding:20px 22px;background-color:${accentSoft};border-left:4px solid ${accent};border-radius:8px;">
                    <p style="margin:0 0 6px;color:#64748b;font-size:12px;line-height:18px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;">Lead</p>
                    <p style="margin:0 0 8px;color:#0f172a;font-size:20px;line-height:28px;font-weight:700;">${safeCompany}</p>
                    <p style="margin:0;color:#334155;font-size:15px;line-height:24px;">${safeDescription}</p>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:0 36px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td style="padding:15px 0;border-top:1px solid #e2e8f0;color:#64748b;font-size:14px;line-height:22px;">Scheduled for</td>
                      <td align="right" style="padding:15px 0;border-top:1px solid #e2e8f0;color:#0f172a;font-size:14px;line-height:22px;font-weight:700;">${safeSchedule}</td>
                    </tr>
                    <tr>
                      <td style="padding:15px 0;border-top:1px solid #e2e8f0;color:#64748b;font-size:14px;line-height:22px;">Priority</td>
                      <td align="right" style="padding:15px 0;border-top:1px solid #e2e8f0;color:${accent};font-size:14px;line-height:22px;font-weight:700;">${safePriority}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 36px 34px;">
                  <p style="margin:0;padding:16px 18px;border-radius:8px;background-color:#f8fafc;color:#475569;font-size:14px;line-height:22px;text-align:center;">Please update the follow-up or close this lead in CRM.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 36px;background-color:#0f172a;color:#94a3b8;font-size:12px;line-height:18px;text-align:center;">
                  This is an automated CRM notification. No reply is required.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>`;
}

function leadId(lead = {}) {
  return String(lead._id || lead.id || lead.sourceLeadId || lead.leadCode || '').trim();
}

function listFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.leads || payload?.data?.leads || payload?.data || payload?.items || [];
}

async function getCcpLeads() {
  try {
    return await Lead.find({}).select(LEAD_REMINDER_PROJECTION).maxTimeMS(15000).lean();
  } catch (error) {
    console.warn('CRM lead reminder fetch failed', error.message);
    throw error;
  }
}

async function admins(roles = ['superadmin']) {
  return User.find({ role: { $in: roles }, isActive: { $ne: false } }).select('_id name email').lean();
}

async function usersForIdentities(rows = []) {
  const options = [];
  rows.forEach((row = {}) => {
    const id = String(row.createdByCrmUserId || row.assignedStaff || row.assignedTo || '').trim();
    const email = String(row.createdByEmail || row.assignedStaffEmail || row.assignedToEmail || '').trim().toLowerCase();
    const name = String(row.createdByName || '').trim();
    if (id) {
      options.push({ crmUserId: id });
      if (mongoose.isValidObjectId(id)) options.push({ _id: id });
    }
    if (email) options.push({ email });
    if (name) options.push({ name });
  });
  if (!options.length) return [];
  return User.find({ $or: options, isActive: { $ne: false } })
    .select('_id name email role managerId operationHeadId').lean();
}

async function followUpRecipients(lead, openServiceRows = null) {
  const serviceRows = openServiceRows || (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []);
  // Follow-up emails are private work reminders. Send them only to the user
  // who owns the open service/lead, never to managers, admins or superadmins.
  const contributors = await usersForIdentities(serviceRows);
  const hasServiceOwnership = serviceRows.some((row = {}) => row.createdByCrmUserId || row.createdByEmail || row.createdByName);
  const fallback = contributors.length || hasServiceOwnership ? null : await resolveLeadUser(lead);
  const byId = new Map([...contributors, ...(fallback ? [fallback] : [])].map((user) => [String(user._id), user]));
  return [...byId.values()];
}

async function resolveManager(value) {
  const id = String(value || '').trim();
  if (!id) return null;
  const options = [{ crmUserId: id }];
  if (mongoose.isValidObjectId(id)) options.unshift({ _id: id });
  return User.findOne({ $or: options, role: 'manager', isActive: { $ne: false } }).select('_id name email').lean();
}

async function resolveLeadUser(lead) {
  // Bulk Excel ownership is explicitly supplied per row. For those records,
  // the Created By user must receive the pending-lead reminder even when the
  // uploader or an assignment belongs to someone else. Manual leads retain
  // the existing assignment-first recipient behavior.
  const assignment = lead.bulkImported
    ? {}
    : ([...(Array.isArray(lead.assignments) ? lead.assignments : [])].reverse().find((row) => row?.assignedStaff || row?.assignedTo) || lead);
  const creatorRow = (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []).find((row) => row?.createdByCrmUserId || row?.createdByEmail || row?.createdByName) || {};
  const id = String(assignment.assignedStaff || assignment.assignedTo || lead.createdByCrmUserId || creatorRow.createdByCrmUserId || '').trim();
  const email = String(assignment.assignedStaffEmail || assignment.assignedToEmail || lead.createdByEmail || creatorRow.createdByEmail || '').trim().toLowerCase();
  const name = String(creatorRow.createdByName || lead.createdByName || lead.importedCreatedBy || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const options = [];
  if (id) {
    options.push({ crmUserId: id });
    if (mongoose.isValidObjectId(id)) options.unshift({ _id: id });
  }
  if (email) options.push({ email });
  if (name) options.push({ name });
  return options.length ? User.findOne({ $or: options, isActive: { $ne: false } }).select('_id name email').lean() : null;
}

async function updateCcpLead(id, body) {
  const lead = mongoose.isValidObjectId(String(id || ''))
    ? await Lead.findById(id)
    : await Lead.findOne({ sourceLeadId: String(id || '').trim() });
  if (!lead) return false;
  Object.assign(lead, body || {});
  await lead.save();
  return true;
}

async function remindFollowUps(leads, now) {
  for (const lead of leads) {
    const serviceRows = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
    const assignmentRows = Array.isArray(lead.assignments) ? lead.assignments : [];
    const openServices = serviceRows.map((service, index) => ({ service, index })).filter(({ service, index }) => {
      const assignment = assignmentRows[index] || {};
      return !service.followUpClosedAt && !service.closedBy && !service.closedByText && !service.closedAt
        && !assignment.closedBy && !assignment.closedByText && !assignment.closedAt
        && !(serviceRows.length === 1 && (lead.closedBy || lead.closedByText || lead.closedAt));
    });
    if (!openServices.length) continue;
    for (const { service, index: serviceIndex } of openServices) {
    const followUpDate = service.nextFollowUpDate || (serviceIndex === 0 ? lead.nextFollowUpDate : '');
    const followUpTime = service.nextFollowUpTime || (serviceIndex === 0 ? lead.nextFollowUpTime : '');
    if (!followUpDate) continue;
    const due = new Date(`${followUpDate}T${followUpTime || '09:00'}:00`);
    if (!due.getTime()) continue;
    const stage = followUpEscalationStage(due.getTime(), now);
    if (!stage) continue;
    const key = `${leadId(lead)}:service-${serviceIndex}:${followUpDate}:${followUpTime || ''}:${stage}`;
    if (await Notification.exists({ kind: 'lead_followup_escalation', 'metadata.key': key })) continue;
    const delivery = await claimReminderDelivery(`lead-followup:${key}`, now);
    if (!delivery) continue;
    const recipients = await followUpRecipients(lead, [service]);
    if (!recipients.length) {
      await completeReminderDelivery(`lead-followup:${key}`, false);
      continue;
    }
    const labels = {
      DUE_IN_30M: 'is due within 30 minutes', OVERDUE_30M: 'is overdue by at least 30 minutes',
      OVERDUE_60M: 'is overdue by at least 60 minutes', RED_FLAG_24H: 'is overdue by 24 hours and has been red-flagged',
      PERMANENT_RED_48H: 'is overdue by 48 hours and now has a permanent red flag'
    };
    const company = lead.company || 'Lead';
    const pendingServices = [service];
    const contributorNames = [...new Set(pendingServices.map((row) => row?.createdByName || row?.createdByEmail).filter(Boolean))];
    const serviceNames = [...new Set(pendingServices.map((row) => row?.servicesOffered || row?.applicableService).filter(Boolean))];
    const description = `${company} follow-up ${labels[stage]}. ${contributorNames.join(', ') || 'Assigned user'} added ${serviceNames.join(', ') || 'a service'} but has not closed it.`;
    const isPermanentRed = stage === 'PERMANENT_RED_48H';
    const isRedFlag = stage === 'RED_FLAG_24H' || isPermanentRed;
    const priority = service.followUpPriority || (serviceIndex === 0 ? lead.followUpPriority : '') || 'Medium';
    const item = await Notification.create({ title: isPermanentRed ? 'PERMANENT RED FLAG: Follow-up not completed' : isRedFlag ? 'RED FLAG: Service follow-up overdue' : 'Service follow-up reminder', description, tag: isPermanentRed ? 'Permanent Red Flag' : isRedFlag ? 'Red Flag' : 'Follow-Up', kind: 'lead_followup_escalation', audience: recipients.map((user) => user._id), visibleToRoles: ['admin', 'superadmin'], metadata: { key, stage, leadId: leadId(lead), serviceIndex, dueAt: due.toISOString(), priority, contributorNames, serviceNames } });
    item.crmNotificationId = String(item._id); await item.save();
    const primary = recipients.find((user) => contributorNames.some((name) => [user.name, user.email].includes(name))) || recipients[0];
    if (primary?.email) {
      const html = buildFollowUpReminderEmail({
        company,
        description,
        date: followUpDate,
        time: followUpTime || '',
        priority,
        isRedFlag,
      });
      try {
        await sendMail(primary.email, `${isPermanentRed ? 'PERMANENT RED FLAG' : isRedFlag ? 'RED FLAG' : 'Follow-Up Reminder'} - ${company}`, html, { branded: false });
      } catch (error) {
        await Notification.deleteOne({ _id: item._id }).catch(() => null);
        await completeReminderDelivery(`lead-followup:${key}`, false);
        console.error(`Lead follow-up email failed for ${company}; it will be retried.`, error.message);
        continue;
      }
    }
    await completeReminderDelivery(`lead-followup:${key}`, true);
    if (isRedFlag) await updateCcpLead(leadId(lead), { followUpFlag: isPermanentRed ? 'PERMANENT_RED' : 'RED' }).catch(() => false);
    }
  }
}

function followUpEscalationStage(dueAt, now) {
  const delta = elapsedWithoutSundays(dueAt, now);
  if (delta >= 48 * HOUR) return 'PERMANENT_RED_48H';
  if (delta >= 24 * HOUR) return 'RED_FLAG_24H';
  if (delta >= HOUR) return 'OVERDUE_60M';
  if (delta >= THIRTY_MINUTES) return 'OVERDUE_30M';
  if (delta >= -THIRTY_MINUTES) return 'DUE_IN_30M';
  return '';
}

function indiaMonthKeyOnFirst(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return parts.day === '01' ? `${parts.year}-${parts.month}` : '';
}

function indiaMonthEndKey(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const lastDay = new Date(Date.UTC(Number(parts.year), Number(parts.month), 0)).getUTCDate();
  return Number(parts.day) === lastDay ? `${parts.year}-${parts.month}` : '';
}

function parseServiceDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  const date = match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00`) : new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatServiceDate(value) {
  const date = parseServiceDate(value);
  if (!date) return String(value || '-');
  return [String(date.getDate()).padStart(2, '0'), String(date.getMonth() + 1).padStart(2, '0'), date.getFullYear()].join('/');
}

function formatInr(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
}

async function remindServiceEndDates(now) {
  const quotations = await Quotation.find({ serviceState: { $ne: 'closed' }, 'items.serviceEndDate': { $exists: true, $ne: '' } })
    .populate('createdBy', 'name email managerId operationHeadId').lean();
  let reminded = 0;
  for (const quotation of quotations) {
    const expiring = (quotation.items || []).filter((row) => {
      const end = parseServiceDate(row.serviceEndDate);
      if (!end) return false;
      end.setHours(23, 59, 0, 0);
      const endTime = end.getTime();
      const oneWeekBefore = endTime - ONE_WEEK;
      return now >= oneWeekBefore && now <= endTime;
    });
    if (!expiring.length) continue;
    const dateKey = new Date(now).toISOString().slice(0, 10);
    const key = `${quotation._id}:${dateKey}:service-end-1-week`;
    if (await Notification.exists({ kind: 'service_end_1_week_reminder', 'metadata.key': key })) continue;
    const creator = quotation.createdBy;
    const leaderIds = [creator?.managerId, creator?.operationHeadId].filter(Boolean);
    const [leaders, administrators] = await Promise.all([
      leaderIds.length ? User.find({ _id: { $in: leaderIds }, isActive: { $ne: false } }).select('_id name email').lean() : [],
      admins(['admin', 'superadmin'])
    ]);
    const recipients = [...new Map([...(creator ? [creator] : []), ...leaders, ...administrators].map((user) => [String(user._id), user])).values()];
    if (!recipients.length) continue;
    const customer = quotation.companyName || quotation.leadDetails?.companyName || 'Customer';
    const services = expiring.map((row) => `${row.serviceCategory || row.eprCategory || row.industryType || 'Service'} (ends ${row.serviceEndDate})`);
    const description = `${customer}: 1-week service expiry reminder for ${services.join(', ')}. Service owner: ${creator?.name || quotation.createdByName || 'CRM user'}.`;
    const item = await Notification.create({ title: 'Service expiry 1-week reminder', description, tag: 'Service Expiry', kind: 'service_end_1_week_reminder', audience: recipients.map((user) => user._id), visibleToRoles: ['admin', 'superadmin'], metadata: { key, quotationId: String(quotation._id), customer, services, dateKey } });
    item.crmNotificationId = String(item._id); await item.save();
    const primary = creator?.email ? creator : recipients[0];
    if (primary?.email) {
      const cell = 'padding:12px 10px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:12px;font-weight:700;vertical-align:middle;white-space:nowrap;';
      const rows = expiring.map((row, index) => `<tr style="background:${index % 2 ? '#ffffff' : '#fbfdff'}">
        <td style="${cell}text-align:center">${index + 1}</td>
        <td style="${cell}">${escapeHtml(row.industryType || '-')}</td>
        <td style="${cell}">${escapeHtml(row.serviceCategory || '-')}</td>
        <td style="${cell}">${escapeHtml(formatServiceDate(row.serviceStartDate))}</td>
        <td style="${cell}color:#b91c1c">${escapeHtml(formatServiceDate(row.serviceEndDate))}</td>
        <td style="${cell}">${escapeHtml(row.eprCategory || '-')}</td>
        <td style="${cell}">${escapeHtml(row.subApplicantType || row.piboCategory || row.piboParent || '-')}</td>
        <td style="${cell}color:#0f766e">${escapeHtml(row.serviceAddedBy || creator?.name || quotation.createdByName || 'CRM user')}</td>
        <td style="${cell}text-align:center">${escapeHtml(row.unit || '1')}</td>
        <td style="${cell}text-align:right;color:#0f766e">${escapeHtml(quotation.pricingMode === 'combined' ? (index === 0 ? formatInr(quotation.combinedBasicAmount) : 'Combined') : formatInr(row.basicAmount))}</td>
      </tr>`).join('');
      const headers = ['SR.NO', 'INDUSTRY TYPE', 'SERVICE CATEGORY', 'SERVICE START DATE', 'SERVICE END DATE', 'SERVICE CATEGORY', 'APPLICANT TYPE', 'ADDED BY', 'UNIT', 'BASIC AMOUNT (INR)']
        .map((heading) => `<th style="padding:12px 10px;background:#f1f5f9;color:#64748b;font-size:10px;letter-spacing:.04em;text-align:left;white-space:nowrap">${heading}</th>`).join('');
      const html = `<div style="margin:0;padding:28px 12px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#334155">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
          <table role="presentation" width="1100" cellspacing="0" cellpadding="0" style="width:100%;max-width:1100px;overflow:hidden;border:1px solid #dbe5e7;border-radius:16px;background:#fff">
            <tr><td style="height:7px;background:#0f766e"></td></tr>
            <tr><td style="padding:28px 30px 18px"><span style="display:inline-block;border-radius:99px;background:#fef2f2;padding:7px 11px;color:#b91c1c;font-size:11px;font-weight:800;letter-spacing:.8px">SERVICE EXPIRY · 1 WEEK BEFORE</span><h1 style="margin:16px 0 6px;color:#0f172a;font-size:25px">Quotation Items</h1><p style="margin:0;color:#64748b;font-size:13px">This 1-week before expiry reminder covers the following active services provided to <strong style="color:#0f766e">${escapeHtml(customer)}</strong>. Please initiate renewal discussions.</p></td></tr>
            <tr><td style="padding:0 30px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td style="padding:12px 14px;border:1px solid #dbe5e7;background:#f8fafc;font-size:12px"><strong>Customer:</strong> ${escapeHtml(customer)}</td><td style="padding:12px 14px;border:1px solid #dbe5e7;background:#f8fafc;font-size:12px"><strong>Service owner:</strong> ${escapeHtml(creator?.name || quotation.createdByName || 'CRM user')}</td><td style="padding:12px 14px;border:1px solid #dbe5e7;background:#f8fafc;font-size:12px"><strong>Quotation:</strong> ${escapeHtml(quotation.quotationNumber || '-')}</td></tr></table></td></tr>
            <tr><td style="padding:0 18px 26px"><div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px"><table width="100%" cellspacing="0" cellpadding="0" style="min-width:1000px;border-collapse:collapse"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div><p style="margin:20px 12px 0;padding:14px;border-radius:8px;background:#ecfdf5;color:#065f46;font-size:13px;text-align:center"><strong>Action required:</strong> Please contact the customer for renewal or the next required action.</p></td></tr>
          </table>
        </td></tr></table></div>`;
      const cc = recipients.map((user) => user.email).filter((email) => email && email !== primary.email);
      await sendMail(primary.email, `Service Expiry 1-Week Reminder - ${customer}`, html, { branded: false, cc })
        .catch((error) => console.error(`[Service expiry reminder] Email failed for ${primary.email}`, error));
    }
    reminded += 1;
  }
  return reminded;
}

async function remindManagers(leads, now) {
  for (const lead of leads) {
    const assignment = [...(Array.isArray(lead.assignments) ? lead.assignments : [])].reverse().find((row) => row?.assignedTo) || lead;
    if (!assignment.assignedTo || assignment.assignedStaff || lead.assignedStaff) continue;
    const assignedAt = new Date(lead.updatedAt || lead.importedUpdatedAt || lead.createdAt || lead.importedCreatedAt || 0);
    if (!assignedAt.getTime() || now - assignedAt < DAY) continue;
    const manager = await resolveManager(assignment.assignedTo);
    if (!manager) continue;
    const key = `${leadId(lead)}:${manager._id}`;
    if (await Notification.exists({ kind: 'lead_staff_assignment_24h_reminder', 'metadata.key': key })) continue;
    const company = lead.company || 'Company';
    const description = `${company} has been assigned to you for more than 24 hours and is still not assigned to staff. Please take action.`;
    const item = await Notification.create({ title: 'Staff assignment overdue', description, tag: 'Lead Reminder', kind: 'lead_staff_assignment_24h_reminder', audience: [manager._id], metadata: { key, leadId: leadId(lead), company } });
    item.crmNotificationId = String(item._id); await item.save();
    if (manager.email) await sendMail(manager.email, `24-hour Staff Assignment Reminder - ${company}`, `<div style="font-family:Arial,sans-serif;color:#334155"><h2 style="color:#0f766e">Staff assignment is pending</h2><p>${escapeHtml(description)}</p><p><strong>Assigned Manager:</strong> ${escapeHtml(manager.name || manager.email)}</p><p>Please open CRM and assign this lead to the appropriate staff member.</p></div>`, { branded: false }).catch(() => null);
  }
}

async function remindApprovals(now) {
  const cutoff = new Date(now - (2 * DAY));
  const approvals = await PendingApproval.find({ type: { $in: ['lead_duplicate', 'lead_royalty'] }, approvalStatus: 'PENDING', createdAt: { $lte: cutoff }, reminderCount: 0 }).limit(100);
  if (!approvals.length) return;
  const recipients = await admins(['superadmin']);
  for (const approval of approvals) {
    const kind = approval.type === 'lead_royalty' ? 'Royalty claim' : 'Special approval';
    const description = `${kind} for ${approval.clientName || 'a lead'} has been pending for more than 48 hours. Please approve or reject it.`;
    const item = await Notification.create({ title: `${kind} pending for 48 hours`, description, tag: 'Approval Reminder', kind: 'lead_approval_48h_reminder', audience: recipients.map((user) => user._id), visibleToRoles: ['superadmin'], metadata: { approvalId: String(approval._id), type: approval.type } });
    item.crmNotificationId = String(item._id); await item.save();
    await Promise.allSettled(recipients.filter((user) => user.email).map((user) => sendMail(user.email, `48-hour ${kind} Reminder - ${approval.clientName}`, `<div style="font-family:Arial,sans-serif;color:#334155"><h2 style="color:#0f766e">${escapeHtml(kind)} requires action</h2><p>${escapeHtml(description)}</p><p><strong>Requested by:</strong> ${escapeHtml(approval.createdByName || '-')}</p><p>Please review it in Pending Approval.</p></div>`, { branded: false })));
    approval.reminderCount = 1; approval.lastReminderAt = new Date(); await approval.save();
  }
}

async function remindOldDraftsLegacy(leads, now) {
  const monthKey = indiaMonthKeyOnFirst(now);
  if (!monthKey) return;
  const rows = leads.filter((lead) => {
    const assignmentClosed = (Array.isArray(lead.assignments) ? lead.assignments : []).some((row) => row?.closedBy || row?.closedByText);
    return !lead.closedBy && !lead.closedByText && !assignmentClosed;
  });
  if (!rows.length) return;
  for (const lead of rows) {
    const superAdmins = await admins(['superadmin']);
    const recipient = await resolveLeadUser(lead) || superAdmins.find((user) => user.email);
    if (!recipient) continue;
    const key = `${leadId(lead)}:${monthKey}`;
    if (await Notification.exists({ kind: 'unclosed_lead_monthly', 'metadata.key': key })) continue;
    const company = lead.company || 'Lead';
    const description = `${company} is still pending. This is the monthly reminder for ${monthKey}. Please review and close the lead or update its status.`;
    const audience = [...new Set([recipient._id, ...superAdmins.map((user) => user._id)].map(String))];
    const item = await Notification.create({ title: 'Monthly pending lead reminder', description, tag: 'Pending Leads', kind: 'unclosed_lead_monthly', audience, visibleToRoles: ['superadmin'], metadata: { key, monthKey, leadId: leadId(lead), company } });
    item.crmNotificationId = String(item._id); await item.save();
    if (recipient.email) {
      const services = (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [lead])
        .map((row) => [row?.servicesOffered, row?.applicableService].filter(Boolean).join(' — '))
        .filter(Boolean).join(', ') || '-';
      const html = `<div style="margin:0;padding:30px 14px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#334155">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
          <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;overflow:hidden;border:1px solid #dbe5e7;border-radius:16px;background:#fff">
            <tr><td style="height:7px;background:#0f766e"></td></tr>
            <tr><td style="padding:30px 34px 18px"><span style="display:inline-block;border-radius:99px;background:#fff7ed;padding:7px 11px;color:#c2410c;font-size:11px;font-weight:700;letter-spacing:.8px">MONTHLY ACTION REQUIRED</span><h1 style="margin:16px 0 8px;color:#0f766e;font-size:27px">Pending lead reminder</h1><p style="margin:0;color:#64748b;line-height:1.6">${escapeHtml(description)}</p></td></tr>
            <tr><td style="padding:0 34px 30px"><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
              <tr style="background:#f8fafc"><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0;font-weight:700">Company</td><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0">${escapeHtml(company)}</td></tr>
              <tr><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0;font-weight:700">Lead ID</td><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0">${escapeHtml(lead.leadCode || leadId(lead) || '-')}</td></tr>
              <tr style="background:#f8fafc"><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0;font-weight:700">Lead Date</td><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0">${escapeHtml(lead.createdAt || lead.importedCreatedAt || lead.leadDate || '-')}</td></tr>
              <tr><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0;font-weight:700">Generated By</td><td style="padding:13px 15px;border-bottom:1px solid #e2e8f0">${escapeHtml(lead.importedCreatedBy || lead.createdByName || lead.createdByEmail || '-')}</td></tr>
              <tr style="background:#f8fafc"><td style="padding:13px 15px;font-weight:700">Services</td><td style="padding:13px 15px">${escapeHtml(services)}</td></tr>
            </table><p style="margin:22px 0 0;text-align:center;color:#64748b;font-size:13px">Please open CRM and close the lead or update its status.</p></td></tr>
          </table>
        </td></tr></table></div>`;
      const cc = [...new Set(superAdmins.map((user) => String(user.email || '').trim().toLowerCase()).filter((email) => email && email !== recipient.email.toLowerCase()))];
      await sendMail(recipient.email, `Pending Lead Reminder - ${company}`, html, { branded: false, cc })
        .catch((error) => console.error(`Pending lead email failed for ${recipient.email}`, error));
    }
  }
  return;
  const dayKey = new Date(now).toISOString().slice(0, 10);
  if (await Notification.exists({ kind: 'unclosed_leads_30d_digest', 'metadata.dayKey': dayKey })) return;
  const recipients = await admins(['superadmin']);
  const bodyRows = rows.map((lead, index) => `<tr><td style="padding:9px">${index + 1}</td><td style="padding:9px">${escapeHtml(lead.leadDate || lead.createdAt || '-')}</td><td style="padding:9px">${escapeHtml(lead.importedCreatedBy || '-')}</td><td style="padding:9px">${escapeHtml(lead.company || '-')}</td><td style="padding:9px">${escapeHtml(lead.servicesOffered || '-')}</td><td style="padding:9px">${escapeHtml(lead.firstAnnualReturnYearApplicable || '-')}</td></tr>`).join('');
  const description = `${rows.length} draft lead(s) have remained unclosed for at least 30 days.`;
  const item = await Notification.create({ title: '30-day unclosed lead digest', description, tag: 'Pending Leads', kind: 'unclosed_leads_30d_digest', audience: recipients.map((user) => user._id), visibleToRoles: ['superadmin'], metadata: { dayKey, count: rows.length, leadIds: rows.map(leadId) } });
  item.crmNotificationId = String(item._id); await item.save();
  const html = `<div style="font-family:Arial,sans-serif;color:#334155"><h2 style="color:#0f766e">Unclosed Leads — 30 Day Review</h2><p>${escapeHtml(description)}</p><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#ecfdf5"><th>Sr.</th><th>Lead Date</th><th>Generated By</th><th>Company</th><th>Services</th><th>FY Years</th></tr></thead><tbody>${bodyRows}</tbody></table></div>`;
  await Promise.allSettled(recipients.filter((user) => user.email).map((user) => sendMail(user.email, `30-day Unclosed Leads (${rows.length})`, html, { branded: false })));
}

function elapsedWithoutSundays(startAt, endAt) {
  const start = Number(startAt);
  const end = Number(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return end - start;
  const indiaOffset = 5.5 * HOUR;
  let cursor = start;
  let elapsed = 0;
  while (cursor < end) {
    const indiaTime = new Date(cursor + indiaOffset);
    const nextIndiaMidnight = Date.UTC(indiaTime.getUTCFullYear(), indiaTime.getUTCMonth(), indiaTime.getUTCDate() + 1) - indiaOffset;
    const segmentEnd = Math.min(end, nextIndiaMidnight);
    if (indiaTime.getUTCDay() !== 0) elapsed += segmentEnd - cursor;
    cursor = segmentEnd;
  }
  return elapsed;
}

async function temporaryLeadOwner(row) {
  const options = [];
  const id = String(row.createdBy || '').trim();
  const email = String(row.createdByEmail || '').trim().toLowerCase();
  const name = String(row.createdByName || '').trim();
  if (id) {
    options.push({ crmUserId: id });
    if (mongoose.isValidObjectId(id)) options.push({ _id: id });
  }
  if (email) options.push({ email });
  if (name) options.push({ name });
  return options.length ? User.findOne({ $or: options, isActive: { $ne: false } }).select('_id name email').lean() : null;
}

async function remindTemporaryLeadFollowUps(now) {
  const rows = await TemporaryLead.find({ status: 'DRAFT', pipelineClosedAt: null, nextFollowUpDate: { $exists: true, $nin: ['', null] } }).lean();
  for (const row of rows) {
    const due = new Date(`${row.nextFollowUpDate}T${row.nextFollowUpTime || '09:00'}:00`);
    if (!due.getTime()) continue;
    const stage = followUpEscalationStage(due.getTime(), now);
    if (!stage) continue;
    const key = `${row.tempLeadCode}:${row.nextFollowUpDate}:${row.nextFollowUpTime || ''}:${stage}`;
    if (await Notification.exists({ kind: 'temporary_lead_followup_escalation', 'metadata.key': key })) continue;
    const delivery = await claimReminderDelivery(`temporary-followup:${key}`, now);
    if (!delivery) continue;
    const owner = await temporaryLeadOwner(row);
    if (!owner) {
      await completeReminderDelivery(`temporary-followup:${key}`, false);
      continue;
    }
    const labels = {
      DUE_IN_30M: 'is due within 30 minutes', OVERDUE_30M: 'is overdue by at least 30 minutes',
      OVERDUE_60M: 'is overdue by at least 60 minutes', RED_FLAG_24H: 'is overdue by 24 hours and has been red-flagged',
      PERMANENT_RED_48H: 'is overdue by 48 hours and now has a permanent red flag'
    };
    const isPermanentRed = stage === 'PERMANENT_RED_48H';
    const isRedFlag = stage === 'RED_FLAG_24H' || isPermanentRed;
    const description = `${row.tempLeadCode} · ${row.clientName} temporary lead follow-up ${labels[stage]}. ${row.followUpRemarks || 'Follow-up action is pending.'}`;
    const item = await Notification.create({
      title: isPermanentRed ? 'PERMANENT RED FLAG: Temporary lead follow-up not completed' : isRedFlag ? 'RED FLAG: Temporary lead follow-up overdue' : 'Temporary lead follow-up reminder',
      description,
      tag: isPermanentRed ? 'Permanent Red Flag' : isRedFlag ? 'Red Flag' : 'Follow-Up',
      kind: 'temporary_lead_followup_escalation',
      audience: [owner._id],
      visibleToRoles: [],
      metadata: { key, stage, temporaryLeadId: String(row._id), tempLeadCode: row.tempLeadCode, dueAt: due.toISOString(), priority: row.followUpPriority || 'Medium' }
    });
    item.crmNotificationId = String(item._id); await item.save();
    if (owner.email) {
      const html = buildFollowUpReminderEmail({ company: `${row.clientName} (${row.tempLeadCode})`, description, date: row.nextFollowUpDate, time: row.nextFollowUpTime || '', priority: row.followUpPriority || 'Medium', isRedFlag });
      try {
        await sendMail(owner.email, `${isPermanentRed ? 'PERMANENT RED FLAG' : isRedFlag ? 'RED FLAG' : 'Follow-Up Reminder'} - ${row.clientName} (${row.tempLeadCode})`, html, { branded: false });
      } catch (error) {
        await Notification.deleteOne({ _id: item._id }).catch(() => null);
        await completeReminderDelivery(`temporary-followup:${key}`, false);
        console.error(`Temporary lead follow-up email failed for ${row.tempLeadCode}; it will be retried.`, error.message);
        continue;
      }
    }
    await completeReminderDelivery(`temporary-followup:${key}`, true);
    if (isRedFlag) await TemporaryLead.updateOne({ _id: row._id }, { $set: { followUpFlag: isPermanentRed ? 'PERMANENT_RED' : 'RED' } });
  }
  return rows.length;
}

function buildMonthEndSummaryEmail({ monthKey, openCount, closedCount }) {
  const appUrl = String(process.env.FRONTEND_URL || process.env.APP_URL || 'https://crmananttattva.vercel.app').trim().replace(/\/$/, '');
  const reviewUrl = `${appUrl}/pending-leads/open`;
  const total = openCount + closedCount;
  const closeRate = total ? Math.round((closedCount / total) * 100) : 0;
  const safeMonth = escapeHtml(monthKey);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monthly Lead Summary</title></head><body style="margin:0;padding:0;background-color:#eef4f2;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${safeMonth} review: ${openCount} open and ${closedCount} closed leads.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background-color:#eef4f2"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;border-collapse:separate;background-color:#ffffff;border:1px solid #d9e6e2;border-radius:20px;overflow:hidden;box-shadow:0 14px 36px rgba(15,23,42,.08)"><tr><td style="height:8px;background-color:#087260;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:34px 38px 26px;background-color:#ffffff"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td><span style="display:inline-block;padding:7px 11px;border:1px solid #a7d8ce;border-radius:999px;background-color:#ecfdf8;color:#087260;font-size:10px;font-weight:700;letter-spacing:1.2px">MONTH-END LEAD REVIEW</span></td><td align="right" style="color:#64748b;font-size:13px;font-weight:700">${safeMonth}</td></tr></table><h1 style="margin:22px 0 10px;color:#0f172a;font-size:30px;line-height:38px;font-weight:800">Monthly lead summary</h1><p style="margin:0;color:#64748b;font-size:15px;line-height:24px">Your month-end pipeline snapshot is ready. Review pending leads and keep the next actions moving.</p></td></tr><tr><td style="padding:0 38px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0"><tr><td width="49%" valign="top" style="padding:22px;border:1px solid #fed7aa;border-radius:14px;background-color:#fff7ed"><span style="display:block;color:#9a3412;font-size:11px;font-weight:700;letter-spacing:.8px">OPEN LEADS</span><strong style="display:block;margin-top:8px;color:#c2410c;font-size:36px;line-height:42px">${openCount}</strong><span style="display:block;margin-top:4px;color:#9a3412;font-size:12px;line-height:18px">Require review or follow-up</span></td><td width="2%" style="font-size:0">&nbsp;</td><td width="49%" valign="top" style="padding:22px;border:1px solid #a7f3d0;border-radius:14px;background-color:#ecfdf5"><span style="display:block;color:#065f46;font-size:11px;font-weight:700;letter-spacing:.8px">CLOSED LEADS</span><strong style="display:block;margin-top:8px;color:#047857;font-size:36px;line-height:42px">${closedCount}</strong><span style="display:block;margin-top:4px;color:#065f46;font-size:12px;line-height:18px">Completed during the review</span></td></tr></table></td></tr><tr><td style="padding:12px 38px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;border:1px solid #dbe7e4;border-radius:12px;background-color:#f8fafc"><tr><td style="padding:15px 18px;color:#64748b;font-size:13px">Lead closure ratio</td><td align="right" style="padding:15px 18px;color:#087260;font-size:16px;font-weight:800">${closeRate}%</td></tr></table></td></tr><tr><td align="center" style="padding:28px 38px 34px"><a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:14px 24px;border-radius:10px;background-color:#087260;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">Open Lead Review&nbsp;&nbsp;&rarr;</a><p style="margin:16px 0 0;color:#94a3b8;font-size:11px;line-height:18px">Sign in to CRM to view lead details, ownership and service status.</p></td></tr><tr><td style="padding:18px 30px;background-color:#0f2f2a;color:#a7c4bd;font-size:11px;line-height:18px;text-align:center">Automated month-end notification from AnantTattva CRM &bull; No reply required</td></tr></table></td></tr></table></body></html>`;
}

async function remindOldDrafts(leads, now) {
  const monthKey = indiaMonthEndKey(now);
  if (!monthKey) return;
  const key = `month-end-lead-summary:${monthKey}`;
  const isServiceClosed = (lead, index) => {
    const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
    const assignments = Array.isArray(lead.assignments) ? lead.assignments : [];
    const service = services[index] || {};
    const assignment = assignments[index] || {};
    return Boolean(service.closedBy || service.closedByText || service.closedAt || assignment.closedBy || assignment.closedByText || assignment.closedAt || (services.length === 1 && (lead.closedBy || lead.closedByText || lead.closedAt)));
  };
  const openRows = leads.filter((lead) => {
    const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
    return services.some((_, index) => !isServiceClosed(lead, index));
  });
  const closedRows = leads.filter((lead) => {
    const services = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : [lead];
    return services.some((_, index) => isServiceClosed(lead, index));
  });
  const existing = await Notification.findOne({ kind: 'month_end_lead_summary', 'metadata.key': key });
  const existingOpenCount = Number(existing?.metadata?.openLeadCount);
  const existingClosedCount = Number(existing?.metadata?.closedLeadCount);
  const templateVersion = 2;
  if (existing && existingOpenCount === openRows.length && existingClosedCount === closedRows.length && Number(existing?.metadata?.templateVersion) === templateVersion) return;
  const recipients = await admins(ADMIN_ROLES);
  if (!recipients.length) return;
  const description = `${monthKey} month-end summary: ${openRows.length} open lead(s) and ${closedRows.length} closed lead(s).`;
  const notificationData = { title: 'Month-end lead summary', description, tag: 'Lead Review', kind: 'month_end_lead_summary', audience: recipients.map((user) => user._id), visibleToRoles: ADMIN_ROLES, metadata: { key, monthKey, openLeadCount: openRows.length, closedLeadCount: closedRows.length, templateVersion } };
  const item = existing ? Object.assign(existing, notificationData) : await Notification.create(notificationData);
  item.crmNotificationId = String(item._id); await item.save();
  const html = buildMonthEndSummaryEmail({ monthKey, openCount: openRows.length, closedCount: closedRows.length });
  const recipientEmails = [...new Set(recipients.map((user) => String(user.email || '').trim().toLowerCase()).filter(Boolean))];
  await Promise.allSettled(recipientEmails.map((email) => sendMail(email, `Month-end Lead Summary ${monthKey} - Open ${openRows.length}, Closed ${closedRows.length}`, html, { branded: false })));
}

async function runLeadWorkflowReminders() {
  if (running) return { skipped: true };
  running = true;
  try {
    const now = Date.now();
    const leads = await getCcpLeads();
    await remindManagers(leads, now);
    await remindFollowUps(leads, now);
    const temporaryLeadFollowUps = await remindTemporaryLeadFollowUps(now);
    await remindApprovals(now);
    await remindOldDrafts(leads, now);
    const serviceEndReminders = await remindServiceEndDates(now);
    return { leads: leads.length, temporaryLeadFollowUps, serviceEndReminders };
  } finally { running = false; }
}

function startLeadWorkflowReminderScheduler() {
  if (started) return;
  started = true;
  setTimeout(() => runLeadWorkflowReminders().catch((error) => console.error('Lead workflow reminders failed', error)), 10000);
  // Follow-up stages are checked every minute. The lead summary runs only on
  // the last day in India and is deduplicated by month.
  setInterval(() => runLeadWorkflowReminders().catch((error) => console.error('Lead workflow reminders failed', error)), 60 * 1000);
}

module.exports = {
  runLeadWorkflowReminders,
  startLeadWorkflowReminderScheduler,
  __test: { getCcpLeads, parseServiceDate, formatServiceDate, formatInr, followUpEscalationStage, elapsedWithoutSundays, indiaMonthKeyOnFirst, indiaMonthEndKey, buildMonthEndSummaryEmail, remindTemporaryLeadFollowUps }
};
