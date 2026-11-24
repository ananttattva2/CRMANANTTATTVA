const InternalTicketEmailDelivery = require('../models/InternalTicketEmailDelivery');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function ticketUrl(ticket) {
  const base = String(process.env.FRONTEND_URL || process.env.APP_URL || '').trim().replace(/\/$/, '');
  return base ? `${base}/internal-tickets?ticket=${encodeURIComponent(String(ticket._id))}` : '';
}

function buildInternalTicketEmail({ ticket, sender, recipient, message, hasAttachments }) {
  const senderName = sender.name || sender.email || 'A colleague';
  const preview = String(message || '').trim() || (hasAttachments ? 'Sent an attachment.' : 'Sent a new message.');
  const url = ticketUrl(ticket);
  return `<!doctype html><html><body style="margin:0;background:#f3f6f8;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;padding:28px 12px"><tr><td align="center"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;background:#fff;border:1px solid #dfe7e5;border-radius:16px;overflow:hidden"><tr><td style="background:#0f6655;padding:22px 28px;color:#fff"><div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#bde9df">ANANTTATTVA CRM</div><div style="font-size:22px;font-weight:700;margin-top:6px">New internal ticket message</div></td></tr><tr><td style="padding:28px"><p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hello ${escapeHtml(recipient.name || 'Team Member')},</p><p style="margin:0 0 20px;font-size:15px;line-height:1.6"><strong>${escapeHtml(senderName)}</strong> sent you the first message in an internal ticket.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7faf9;border:1px solid #dfe9e6;border-radius:10px"><tr><td style="padding:18px"><div style="font-size:11px;font-weight:700;color:#5b6b68;text-transform:uppercase;letter-spacing:.8px">${escapeHtml(ticket.ticketNumber || 'Internal Ticket')}</div><div style="font-size:18px;font-weight:700;margin-top:6px;color:#102a25">${escapeHtml(ticket.subject)}</div><div style="border-left:3px solid #f97316;margin-top:16px;padding:2px 0 2px 12px;font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap">${escapeHtml(preview).slice(0, 1200)}</div></td></tr></table>${url ? `<p style="margin:22px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Open Internal Ticket</a></p>` : ''}<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#718096">This notification is sent only for the first message from this sender in this ticket. Please reply inside CRM.</p></td></tr><tr><td style="border-top:1px solid #e7eceb;padding:16px 28px;font-size:11px;color:#82908d">Ananttattva CRM · Internal communication</td></tr></table></td></tr></table></body></html>`;
}

async function claimAndSend({ ticket, sender, recipient, message, hasAttachments }) {
  let delivery;
  try {
    delivery = await InternalTicketEmailDelivery.create({ ticket: ticket._id, sender: sender._id, recipient: recipient._id });
  } catch (error) {
    if (error?.code === 11000) return { skipped: true, reason: 'already-claimed' };
    throw error;
  }

  try {
    await sendMail(
      recipient.email,
      `New message in ${ticket.ticketNumber}: ${ticket.subject}`,
      buildInternalTicketEmail({ ticket, sender, recipient, message, hasAttachments }),
      { branded: false }
    );
    delivery.status = 'sent';
    delivery.sentAt = new Date();
    await delivery.save();
    return { sent: true };
  } catch (error) {
    delivery.status = 'failed';
    delivery.error = String(error?.message || 'Email delivery failed').slice(0, 1000);
    await delivery.save().catch(() => {});
    throw error;
  }
}

async function notifyFirstMessage({ ticket, sender, message, attachments = [] }) {
  const recipientIds = [...new Set([ticket.createdBy, ...(ticket.participants || [])].map(String))]
    .filter((id) => id && id !== String(sender._id));
  if (!recipientIds.length) return [];
  const recipients = await User.find({ _id: { $in: recipientIds }, isActive: { $ne: false }, email: { $ne: '' } }).select('name email').lean();
  return Promise.allSettled(recipients.map((recipient) => claimAndSend({
    ticket, sender, recipient, message, hasAttachments: attachments.length > 0
  })));
}

module.exports = { notifyFirstMessage, buildInternalTicketEmail, claimAndSend };
