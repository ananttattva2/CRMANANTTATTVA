const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function eventLabel(event) {
  return {
    created: 'Generated — Super Admin Approval Pending',
    revised: 'Revised — Super Admin Approval Pending',
    admin_approved: 'Admin Approved — PDF Available',
    approved: 'Approved',
    rejected: 'Rejected'
  }[event] || 'Updated';
}

function formatInr(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function formatDecisionTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function rejectedQuotationEmail({ quotation, quotationNumber, company, actorName, subject }) {
  const decision = quotation.approvalDecision || {};
  const notes = String(decision.remarks || quotation.remarks || '').trim() || 'No rejection notes were provided.';
  const safeNotes = escapeHtml(notes).replace(/\r?\n/g, '<br>');
  const reviewerRole = String(decision.reviewerRole || '').trim();
  const actionBy = reviewerRole ? `${actorName} · ${reviewerRole}` : actorName;
  const appUrl = String(process.env.FRONTEND_URL || process.env.APP_URL || 'https://crmananttattva.vercel.app').trim().replace(/\/$/, '');
  const quotationUrl = `${appUrl}/quotations`;
  const amount = quotation.grandTotal ?? quotation.totalAmount ?? quotation.subtotal;
  const html = `<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quotation Rejected</title></head>
  <body style="margin:0;padding:0;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;color:#172033">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(quotationNumber)} was rejected. Review the admin notes and revise the quotation.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#f4f7f6">
      <tr><td align="center" style="padding:32px 12px">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;box-shadow:0 14px 38px rgba(15,23,42,.09)">
          <tr><td style="height:8px;background:#dc2626;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr><td style="padding:32px 36px 24px;background:#fff">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td><span style="display:inline-block;padding:7px 12px;border:1px solid #fecaca;border-radius:999px;background:#fef2f2;color:#b91c1c;font-size:11px;font-weight:800;letter-spacing:1px">ACTION REQUIRED</span></td>
              <td align="right" style="color:#94a3b8;font-size:12px;font-weight:700">${escapeHtml(formatDecisionTime(decision.actionAt))}</td>
            </tr></table>
            <h1 style="margin:22px 0 10px;color:#991b1b;font-size:30px;line-height:38px;font-weight:800">Quotation Rejected</h1>
            <p style="margin:0;color:#64748b;font-size:15px;line-height:24px"><strong style="color:#172033">${escapeHtml(quotationNumber)}</strong> for <strong style="color:#172033">${escapeHtml(company)}</strong> has been rejected and needs revision before it can move forward.</p>
          </td></tr>
          <tr><td style="padding:0 36px 22px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
              <tr><td style="padding:13px 16px;background:#f8fafc;color:#64748b;font-size:12px;font-weight:700">Quotation</td><td align="right" style="padding:13px 16px;background:#f8fafc;color:#0f172a;font-size:13px;font-weight:800">${escapeHtml(quotationNumber)}</td></tr>
              <tr><td style="padding:13px 16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;font-weight:700">Company</td><td align="right" style="padding:13px 16px;border-top:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:700">${escapeHtml(company)}</td></tr>
              <tr><td style="padding:13px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#64748b;font-size:12px;font-weight:700">Quotation value</td><td align="right" style="padding:13px 16px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#0f766e;font-size:14px;font-weight:800">${escapeHtml(formatInr(amount))}</td></tr>
              <tr><td style="padding:13px 16px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;font-weight:700">Reviewed by</td><td align="right" style="padding:13px 16px;border-top:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:700">${escapeHtml(actionBy)}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 36px 24px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #fecaca;border-radius:14px;background:#fff7f7">
              <tr><td style="padding:18px 20px">
                <p style="margin:0 0 9px;color:#991b1b;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase">Admin rejection notes</p>
                <p style="margin:0;color:#7f1d1d;font-size:15px;line-height:24px;font-weight:600">${safeNotes}</p>
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 36px 8px">
            <p style="margin:0 0 10px;color:#0f172a;font-size:14px;font-weight:800">What to do next</p>
            <p style="margin:0;color:#64748b;font-size:14px;line-height:23px">Review the notes above, update the quotation, verify pricing and service details, then submit the revised quotation for approval.</p>
          </td></tr>
          <tr><td align="center" style="padding:26px 36px 34px"><a href="${escapeHtml(quotationUrl)}" style="display:inline-block;padding:14px 24px;border-radius:10px;background:#0f766e;color:#fff;font-size:14px;font-weight:800;text-decoration:none">Open Quotation in CRM&nbsp;&nbsp;&rarr;</a></td></tr>
          <tr><td style="padding:18px 28px;background:#172033;color:#94a3b8;font-size:11px;line-height:18px;text-align:center">Automated quotation workflow notification from AnantTattva CRM &bull; No reply required</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
  return { subject, html };
}

function quotationLifecycleEmailContent({ quotation = {}, event, actor = {} }) {
  const label = eventLabel(event);
  const quotationNumber = String(quotation.quotationNumber || 'Quotation').trim();
  const company = String(quotation.companyName || quotation.leadDetails?.companyName || 'Client').trim();
  const actorName = String(actor.name || actor.email || 'CRM User').trim();
  const decision = event === 'approved' || event === 'rejected' || event === 'admin_approved';
  const subject = `${quotationNumber} - ${label}`;
  if (event === 'rejected') return rejectedQuotationEmail({ quotation, quotationNumber, company, actorName, subject });
  const intro = event === 'admin_approved'
    ? `${quotationNumber} for ${company} was approved by Admin. The quotation PDF is now available; final Super Admin approval is still pending.`
    : decision
    ? `${quotationNumber} for ${company} has been ${event}.`
    : event === 'revised'
      ? `${quotationNumber} for ${company} was revised and sent directly to Super Admin for final approval. Admin approval is not required.`
      : `${quotationNumber} for ${company} was generated and sent directly to Super Admin for final approval. Admin approval is not required.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#334155">
    <h2 style="color:#0f766e">Quotation ${escapeHtml(label)}</h2>
    <p>${escapeHtml(intro)}</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
      <tr><td style="padding:10px;background:#ecfdf5;font-weight:700">Quotation</td><td style="padding:10px">${escapeHtml(quotationNumber)}</td></tr>
      <tr><td style="padding:10px;background:#ecfdf5;font-weight:700">Company</td><td style="padding:10px">${escapeHtml(company)}</td></tr>
      <tr><td style="padding:10px;background:#ecfdf5;font-weight:700">Status</td><td style="padding:10px">${escapeHtml(label)}</td></tr>
      <tr><td style="padding:10px;background:#ecfdf5;font-weight:700">Action By</td><td style="padding:10px">${escapeHtml(actorName)}</td></tr>
    </table>
    <p style="margin-top:16px">Open CRM Quotations to review the latest details and request Management Approval.</p>
  </div>`;
  return { subject, html };
}

async function resolveRecipients(quotation = {}, actor = {}) {
  const admins = await User.find({
    role: { $in: ['admin', 'superadmin'] },
    isActive: { $ne: false },
    email: { $ne: '' }
  }).select('_id name email').lean();

  let creator = quotation.createdBy && typeof quotation.createdBy === 'object'
    ? quotation.createdBy
    : null;
  if (!creator?.email && quotation.createdBy) {
    creator = await User.findById(quotation.createdBy).select('_id name email').lean();
  }
  if (!creator?.email && quotation.createdByName) {
    creator = await User.findOne({
      $or: [
        { email: String(quotation.createdByName).trim().toLowerCase() },
        { name: String(quotation.createdByName).trim() }
      ],
      isActive: { $ne: false }
    }).select('_id name email').lean();
  }

  const recipients = [...admins, creator, actor]
    .filter((user) => user?.email)
    .map((user) => ({ name: user.name || user.email, email: String(user.email).trim().toLowerCase() }));
  return [...new Map(recipients.map((user) => [user.email, user])).values()];
}

async function sendQuotationLifecycleEmail({ quotation, event, actor }) {
  const recipients = await resolveRecipients(quotation, actor);
  const content = quotationLifecycleEmailContent({ quotation, event, actor });
  const results = await Promise.allSettled(recipients.map((recipient) =>
    sendMail(recipient.email, content.subject, content.html, { branded: false })
  ));
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length) {
    console.error('[Quotation lifecycle email] delivery failures', {
      event,
      quotationId: String(quotation?._id || ''),
      failed: failed.length,
      total: recipients.length
    });
  }
  return { recipients: recipients.length, sent: results.length - failed.length, failed: failed.length };
}

module.exports = {
  eventLabel,
  quotationLifecycleEmailContent,
  resolveRecipients,
  sendQuotationLifecycleEmail
};
