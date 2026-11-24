const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const PendingApproval = require('../models/PendingApproval');
const Quotation = require('../models/Quotation');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { userHasAnyRole } = require('../utils/userRoles');

const APP_BASE_URL = readAppBaseUrl();
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;

function readAppBaseUrl() {
  const candidates = [process.env.APP_URL, process.env.FRONTEND_URL, process.env.CLIENT_ORIGIN, 'http://localhost:4173'];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value || value === '*') continue;
    try { return new URL(value).origin; } catch { /* use the next configured URL */ }
  }
  return 'http://localhost:4173';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatInr(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(amount);
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(date).replace(/\//g, '-');
}

function indiaDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function indiaWeekKey(value = new Date()) {
  const [year, month, day] = indiaDateKey(value).split('-').map(Number);
  const localDate = new Date(Date.UTC(year, month - 1, day));
  const isoDay = localDate.getUTCDay() || 7;
  localDate.setUTCDate(localDate.getUTCDate() + 4 - isoDay);
  const isoYear = localDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((localDate - yearStart) / (24 * 60 * 60 * 1000)) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function managementApprovalUrl() {
  const url = new URL('/pending-approval', APP_BASE_URL);
  url.searchParams.set('tab', 'quotations');
  return url.toString();
}

function pendingDays(record, now = new Date()) {
  const createdAt = new Date(record.createdAt || record.updatedAt || now);
  if (Number.isNaN(createdAt.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000)));
}

function normalizeDigestRows(records, quotations, now = new Date()) {
  const quotationById = new Map(quotations.map((quotation) => [String(quotation._id), quotation]));
  const pendingStatuses = new Set(['draft', 'submitted', 'sent', 'admin_approved']);
  const recordedQuotationIds = new Set();
  const rows = records.flatMap((record) => {
    const payload = record.payload || {};
    const quotationId = String(record.sourceClientId || payload.quotationId || '').trim();
    const quotation = quotationById.get(quotationId) || {};
    const sourceStatus = String(quotation.status || '').trim().toLowerCase();
    if (quotation._id && sourceStatus && !pendingStatuses.has(sourceStatus)) return [];
    if (quotationId) recordedQuotationIds.add(quotationId);
    const details = quotation.leadDetails || {};
    const amount = Number(quotation.grandTotal ?? payload.grandTotal ?? payload.basicAmount ?? 0) || 0;
    return [{
      id: String(record._id),
      quotationId,
      quotationNumber: quotation.quotationNumber || record.uniqueId || payload.quotationNumber || '-',
      companyName: details.companyName || quotation.companyName || record.clientName || payload.companyName || 'Untitled quotation',
      createdBy: record.createdByName || payload.createdBy || payload.userName || quotation.createdBy?.name || quotation.createdBy?.email || quotation.createdByName || '-',
      quotationDate: quotation.quotationDate || record.requestDate || payload.quotationDate || record.createdAt,
      service: payload.service || quotation.items?.[0]?.serviceCategory || '-',
      category: payload.category || quotation.items?.[0]?.eprCategory || '-',
      amount,
      pendingDays: pendingDays(record, now)
    }];
  });

  quotations.forEach((quotation) => {
    const quotationId = String(quotation._id || '');
    if (recordedQuotationIds.has(quotationId) || !pendingStatuses.has(String(quotation.status || '').toLowerCase())) return;
    const details = quotation.leadDetails || {};
    rows.push({
      id: `quotation-${quotationId}`,
      quotationId,
      quotationNumber: quotation.quotationNumber || '-',
      companyName: details.companyName || quotation.companyName || 'Untitled quotation',
      createdBy: quotation.createdBy?.name || quotation.createdBy?.email || quotation.createdByName || '-',
      quotationDate: quotation.quotationDate || quotation.createdAt,
      service: quotation.items?.[0]?.serviceCategory || '-',
      category: quotation.items?.[0]?.eprCategory || '-',
      amount: Number(quotation.grandTotal || 0),
      pendingDays: pendingDays(quotation, now)
    });
  });
  return rows.sort((a, b) => b.pendingDays - a.pendingDays || String(a.quotationNumber).localeCompare(String(b.quotationNumber)));
}

function buildTableRows(rows) {
  return rows.map((row, index) => `
    <tr>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:12px;font-weight:800;text-align:center;">${index + 1}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#ea580c;font-size:12px;font-weight:900;white-space:nowrap;">${escapeHtml(row.quotationNumber)}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-size:12px;font-weight:900;">${escapeHtml(row.companyName)}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#475569;font-size:12px;font-weight:700;">${escapeHtml(row.createdBy)}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#475569;font-size:12px;font-weight:700;white-space:nowrap;">${escapeHtml(formatDate(row.quotationDate))}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#475569;font-size:12px;font-weight:700;">${escapeHtml(row.service)}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#475569;font-size:12px;font-weight:700;">${escapeHtml(row.category)}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:#0f766e;font-size:12px;font-weight:900;text-align:right;white-space:nowrap;">${escapeHtml(formatInr(row.amount))}</td>
      <td style="padding:11px 9px;border-bottom:1px solid #e5e7eb;color:${row.pendingDays >= 7 ? '#b91c1c' : '#92400e'};font-size:12px;font-weight:900;text-align:center;white-space:nowrap;">${row.pendingDays} day${row.pendingDays === 1 ? '' : 's'}</td>
    </tr>
  `).join('');
}

function buildWeeklyPendingQuotationEmail({ rows, recipientName, weekEnding }) {
  const pendingCount = rows.length;
  const totalValue = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const oldestDays = rows.reduce((maximum, row) => Math.max(maximum, Number(row.pendingDays) || 0), 0);
  const approvalLink = escapeHtml(managementApprovalUrl());
  return `<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly Pending Quotation Approval Report</title></head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${pendingCount} quotation${pendingCount === 1 ? '' : 's'} are still waiting for your management approval.</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f1f5f9;"><tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:1040px;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #dbe3ef;border-radius:20px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.10);">
        <tr><td style="background:linear-gradient(120deg,#0f766e,#064e3b);padding:30px 32px;">
          <div style="color:#a7f3d0;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.13em;">Anant Tattva CRM · Week ending ${escapeHtml(weekEnding)}</div>
          <div style="margin-top:9px;color:#fff;font-size:29px;line-height:1.2;font-weight:900;">Weekly Pending Quotation Approval Report</div>
          <div style="margin-top:10px;color:#d1fae5;font-size:14px;line-height:1.65;">Hello ${escapeHtml(recipientName || 'Super Admin')}, ${pendingCount} quotation${pendingCount === 1 ? ' is' : 's are'} still waiting for your final management approval.</div>
        </td></tr>
        <tr><td style="padding:24px 30px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="width:32%;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:13px;padding:16px;"><div style="color:#047857;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;">Still Pending</div><div style="margin-top:7px;color:#064e3b;font-size:30px;font-weight:900;">${pendingCount}</div></td>
            <td style="width:2%;"></td><td style="width:32%;background:#fff7ed;border:1px solid #fed7aa;border-radius:13px;padding:16px;"><div style="color:#c2410c;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;">Pending Value</div><div style="margin-top:7px;color:#9a3412;font-size:21px;font-weight:900;">${escapeHtml(formatInr(totalValue))}</div></td>
            <td style="width:2%;"></td><td style="width:32%;background:#fef2f2;border:1px solid #fecaca;border-radius:13px;padding:16px;"><div style="color:#b91c1c;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;">Oldest Pending</div><div style="margin-top:7px;color:#991b1b;font-size:23px;font-weight:900;">${oldestDays} day${oldestDays === 1 ? '' : 's'}</div></td>
          </tr></table>
        </td></tr>
        <tr><td align="center" style="padding:16px 30px 22px;"><a href="${approvalLink}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;border-radius:11px;padding:14px 24px;font-size:14px;font-weight:900;box-shadow:0 9px 20px rgba(234,88,12,.24);">Review Pending Quotations</a></td></tr>
        <tr><td style="padding:0 20px 28px;overflow-x:auto;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="min-width:920px;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:13px;overflow:hidden;">
            <tr>
              ${['#', 'Quotation No.', 'Company', 'Created By', 'Quotation Date', 'Service', 'Category', 'Amount', 'Pending For'].map((heading) => `<th style="padding:11px 9px;background:#f8fafc;border-bottom:1px solid #dbe3ef;color:#64748b;font-size:10px;font-weight:900;text-transform:uppercase;text-align:${heading === 'Amount' ? 'right' : heading === '#' || heading === 'Pending For' ? 'center' : 'left'};white-space:nowrap;">${heading}</th>`).join('')}
            </tr>
            ${buildTableRows(rows)}
          </table>
          <div style="margin-top:15px;background:#fffbeb;border:1px solid #fde68a;border-radius:11px;padding:13px 15px;color:#92400e;font-size:12px;line-height:1.6;font-weight:700;">This weekly escalation contains the complete list of quotations that were still pending when the report was generated. Approved or rejected quotations are automatically excluded from the next report.</div>
          <div style="margin-top:14px;color:#64748b;font-size:11px;line-height:1.55;text-align:center;">Button not working? <a href="${approvalLink}" style="color:#047857;text-decoration:underline;word-break:break-all;">${approvalLink}</a></div>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

async function readSuperAdminRecipients() {
  const users = await User.find({ isActive: { $ne: false }, email: { $exists: true, $ne: '' } })
    .select('_id name email role roles')
    .sort({ name: 1, email: 1 })
    .lean();
  return users.filter((user) => userHasAnyRole(user, ['superadmin']));
}

async function claimDigestRun({ key, weekEnding, recipients, rowCount, now }) {
  let marker = await Notification.findOne({ crmNotificationId: key });
  if (marker?.status === 'Sent') return { marker, skip: 'already-sent' };
  if (marker?.status === 'Sending' && now.getTime() - new Date(marker.updatedAt).getTime() < LOCK_TIMEOUT_MS) {
    return { marker, skip: 'already-running' };
  }
  if (!marker) {
    try {
      marker = await Notification.create({
        title: 'Weekly pending quotation approval report',
        description: `${rowCount} quotation approval${rowCount === 1 ? '' : 's'} pending at week end.`,
        tag: 'Quotation Approval',
        kind: 'weekly_pending_quotation_digest',
        status: 'Sending',
        audience: recipients.map((recipient) => recipient._id),
        visibleToRoles: ['superadmin'],
        crmNotificationId: key,
        metadata: { weekEnding, pendingCount: rowCount, sentEmails: [], failedEmails: [] }
      });
      return { marker };
    } catch (error) {
      if (error?.code !== 11000) throw error;
      marker = await Notification.findOne({ crmNotificationId: key });
      return { marker, skip: 'already-running' };
    }
  }
  marker.status = 'Sending';
  marker.audience = recipients.map((recipient) => recipient._id);
  marker.metadata = { ...(marker.metadata || {}), pendingCount: rowCount, failedEmails: [] };
  await marker.save();
  return { marker };
}

async function runWeeklyPendingQuotationDigest({ now = new Date() } = {}) {
  const records = await PendingApproval.find({
    type: 'quotation', approvalStatus: 'PENDING',
    'payload.managementApprovalStatus': 'PENDING'
  })
    .sort({ createdAt: 1 })
    .lean();
  const quotationIds = records
    .map((record) => String(record.sourceClientId || record.payload?.quotationId || ''))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const [quotations, recipients] = await Promise.all([
    Quotation.find({
      $or: [
        { _id: { $in: quotationIds } },
        { 'managementApproval.status': 'PENDING', status: { $in: ['draft', 'submitted', 'sent', 'admin_approved'] } }
      ]
    })
      .select('_id quotationNumber companyName leadDetails quotationDate grandTotal items createdBy createdByName status createdAt')
      .populate('createdBy', 'name email')
      .lean(),
    readSuperAdminRecipients()
  ]);
  const rows = normalizeDigestRows(records, quotations, now);
  if (!rows.length) return { skipped: true, reason: 'no-pending-quotations', pending: 0, sent: 0 };
  if (!recipients.length) return { skipped: true, reason: 'no-active-superadmin-email', pending: rows.length, sent: 0 };

  const weekEnding = indiaDateKey(now);
  const key = `weekly-pending-quotation-digest:${indiaWeekKey(now)}`;
  const claim = await claimDigestRun({ key, weekEnding, recipients, rowCount: rows.length, now });
  if (claim.skip) return { skipped: true, reason: claim.skip, pending: rows.length, sent: 0 };

  const alreadySent = new Set((claim.marker.metadata?.sentEmails || []).map((email) => String(email).toLowerCase()));
  const results = [];
  for (const recipient of recipients) {
    const email = String(recipient.email || '').trim().toLowerCase();
    if (alreadySent.has(email)) continue;
    try {
      await sendMail(
        email,
        `Weekly report: ${rows.length} quotation${rows.length === 1 ? '' : 's'} awaiting Super Admin approval`,
        buildWeeklyPendingQuotationEmail({ rows, recipientName: recipient.name || recipient.email, weekEnding })
      );
      results.push({ email, sent: true });
      await Notification.updateOne({ _id: claim.marker._id }, { $addToSet: { 'metadata.sentEmails': email } });
    } catch (error) {
      results.push({ email, sent: false, error: error.message || 'Mail delivery failed' });
    }
  }

  const sentEmails = [...alreadySent, ...results.filter((result) => result.sent).map((result) => result.email)];
  const failed = results.filter((result) => !result.sent);
  const complete = recipients.every((recipient) => sentEmails.includes(String(recipient.email || '').trim().toLowerCase()));
  await Notification.updateOne({ _id: claim.marker._id }, {
    $set: {
      status: complete ? 'Sent' : 'Partial',
      description: `${rows.length} pending quotation approval${rows.length === 1 ? '' : 's'} reported to ${sentEmails.length} Super Admin${sentEmails.length === 1 ? '' : 's'}.`,
      'metadata.pendingCount': rows.length,
      'metadata.totalValue': rows.reduce((sum, row) => sum + row.amount, 0),
      'metadata.sentEmails': sentEmails,
      'metadata.failedEmails': failed
    }
  });

  return { ok: complete, pending: rows.length, recipients: recipients.length, sent: results.filter((result) => result.sent).length, failed: failed.length, weekEnding };
}

module.exports = {
  runWeeklyPendingQuotationDigest,
  __test: { buildWeeklyPendingQuotationEmail, indiaDateKey, indiaWeekKey, normalizeDigestRows, pendingDays }
};
