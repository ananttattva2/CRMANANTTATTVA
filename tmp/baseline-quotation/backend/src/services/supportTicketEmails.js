const { sendMail } = require('../utils/mailer');

const SUPPORT_RECIPIENTS = ['it_support@ananttattva.com', 'it_admin@ananttattva.com'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function detailRow(label, value) {
  return `<tr><td style="padding:10px 14px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;width:150px">${escapeHtml(label)}</td><td style="padding:10px 14px;color:#0f172a;font-size:13px;font-weight:600;border-bottom:1px solid #e2e8f0">${escapeHtml(value || '-')}</td></tr>`;
}

function emailFrame(title, intro, content, color = '#0f766e') {
  return `<div style="background:#f1f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#334155"><div style="max-width:680px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0"><div style="background:${color};padding:24px 28px;color:#ffffff"><div style="font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;opacity:.8">Anant Tattva CRM Support</div><h1 style="font-size:24px;line-height:1.3;margin:8px 0 0">${escapeHtml(title)}</h1></div><div style="padding:26px 28px"><p style="font-size:15px;line-height:1.7;margin:0 0 20px">${intro}</p>${content}<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#94a3b8">This is an automated notification from Anant Tattva CRM. Please use the Support Tickets section in the CRM to review or reply.</p></div></div></div>`;
}

function buildRaisedEmail(ticket) {
  const table = `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">${detailRow('Ticket Number', ticket.ticketNumber)}${detailRow('Raised By', ticket.createdByName)}${detailRow('User Email', ticket.createdByEmail)}${detailRow('Category', ticket.category)}${detailRow('Priority', ticket.priority)}${detailRow('Reference Number', ticket.referenceNumber)}${detailRow('Subject', ticket.subject)}</table><div style="margin-top:18px;padding:16px;background:#f8fafc;border-left:4px solid #f97316;border-radius:8px"><div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Issue details</div><div style="margin-top:8px;font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap">${escapeHtml(ticket.description)}</div></div>`;
  return {
    subject: `[${ticket.priority}] New Support Ticket ${ticket.ticketNumber} - ${ticket.subject}`,
    html: emailFrame('A new support ticket has been raised', `Hello IT Support Team,<br><br><strong>${escapeHtml(ticket.createdByName || ticket.createdByEmail)}</strong> has raised a new CRM support ticket. The complete request is provided below.`, table, '#0f5d46')
  };
}

function buildResolvedEmail(ticket, actor, resolutionNote = '', attachments = []) {
  const isClosed = ticket.status === 'Closed';
  const action = isClosed ? 'closed' : 'resolved';
  const note = resolutionNote ? `<div style="margin-top:18px;padding:16px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px"><div style="font-size:12px;font-weight:700;color:#047857;text-transform:uppercase;letter-spacing:1px">Resolution note</div><div style="margin-top:8px;font-size:14px;line-height:1.7;color:#065f46;white-space:pre-wrap">${escapeHtml(resolutionNote)}</div></div>` : '';
  const evidence = (Array.isArray(attachments) ? attachments : []).filter((item) => /^https:\/\//i.test(String(item?.url || ''))).map((item, index) => `<a href="${escapeHtml(item.url)}" style="display:inline-block;margin:8px 8px 0 0;padding:9px 12px;background:#ffffff;border:1px solid #a7f3d0;border-radius:8px;color:#047857;font-size:12px;font-weight:700;text-decoration:none">View screenshot ${index + 1}</a>`).join('');
  const evidenceBlock = evidence ? `<div style="margin-top:16px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px"><div style="font-size:12px;font-weight:700;color:#047857;text-transform:uppercase;letter-spacing:1px">Resolution screenshots</div>${evidence}</div>` : '';
  const table = `<table style="width:100%;border-collapse:collapse;border:1px solid #d1fae5;border-radius:12px;overflow:hidden">${detailRow('Ticket Number', ticket.ticketNumber)}${detailRow('Category', ticket.category)}${detailRow('Subject', ticket.subject)}${detailRow('Final Status', ticket.status)}${detailRow('Resolved By', actor?.name || actor?.email || 'IT Support Team')}</table>${note}${evidenceBlock}`;
  return {
    subject: `Successfully ${isClosed ? 'Closed' : 'Resolved'}: ${ticket.ticketNumber} - ${ticket.subject}`,
    html: emailFrame(`Your support ticket has been successfully ${action}`, `Hello <strong>${escapeHtml(ticket.createdByName || 'User')}</strong>,<br><br>We are pleased to inform you that your support request has been successfully ${action}.`, `${table}<p style="margin:20px 0 0;font-size:14px;line-height:1.7">If you still need assistance, please raise a new request from the Support Tickets section in the CRM.</p>`, '#059669')
  };
}

async function notifyTicketRaised(ticket) {
  const content = buildRaisedEmail(ticket);
  return sendMail(SUPPORT_RECIPIENTS, content.subject, content.html, { branded: false });
}

async function notifyTicketResolved(ticket, actor, resolutionNote, attachments = []) {
  if (!ticket.createdByEmail) return null;
  const content = buildResolvedEmail(ticket, actor, resolutionNote, attachments);
  return sendMail(ticket.createdByEmail, content.subject, content.html, { branded: false });
}

module.exports = { SUPPORT_RECIPIENTS, buildRaisedEmail, buildResolvedEmail, notifyTicketRaised, notifyTicketResolved };
