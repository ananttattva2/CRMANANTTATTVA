const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const DataExport = require('../models/DataExport');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');
const { buildCompanySignature, getIntroductionLogoAttachment } = require('../services/leadIntroductionEmail');
const { escapeHtml } = require('../services/quotationDelivery');

async function deliverExportEmail({ record, recipients, subject, html }) {
  const results = await Promise.allSettled(recipients.map(email => sendMail(email, subject, html, {
    branded: false,
    attachments: [getIntroductionLogoAttachment()]
  })));
  record.notifiedEmails = recipients.filter((_, index) => results[index].status === 'fulfilled');
  record.emailErrors = results
    .map((result, index) => result.status === 'rejected' ? `${recipients[index]}: ${result.reason?.message || 'Email delivery failed'}` : '')
    .filter(Boolean);
  record.emailAttempts = Number(record.emailAttempts || 0) + 1;
  record.lastEmailAttemptAt = new Date();
  record.emailStatus = record.notifiedEmails.length === recipients.length
    ? 'sent'
    : record.notifiedEmails.length
      ? 'partial'
      : 'failed';
  await record.save();
  if (record.emailStatus !== 'sent') {
    console.error('[data-export-email]', {
      exportId: String(record._id),
      status: record.emailStatus,
      failures: record.emailErrors
    });
  }
}

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const reason = String(req.body.reason || '').trim();
    const section = String(req.body.section || '').trim();
    const filename = String(req.body.filename || '').trim().slice(0, 240);
    if (reason.length < 5 || reason.length > 2000 || !section || section.length > 200) return res.status(400).json({ error: 'Enter an export reason (5–2000 characters) and a valid section.' });
    const admins = await User.find({ isActive: true, $or: [{ role: { $in: ['admin', 'superadmin'] } }, { roles: { $in: ['admin', 'superadmin'] } }] }).select('_id name email').lean();
    if (!admins.length) return res.status(503).json({ error: 'No active administrators are available for the export notification. Contact your admin.' });
    const recipients = [...new Set(admins.map(user => user.email).filter(Boolean))];
    const record = await DataExport.create({ userId: req.user._id, userName: req.user.name, userEmail: req.user.email, section, filename, reason });
    const date = record.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'long' });
    const fields = { User: `${req.user.name || ''} (${req.user.email})`, Section: section, File: filename, Reason: reason, 'Date & time (IST)': date, 'Audit reference': String(record._id) };
    const html = `<h2>CRM data export</h2><p>The following user requested and was authorized to export data.</p><table>${Object.entries(fields).map(([key, value]) => `<tr><th align="left" style="padding:8px">${key}</th><td style="padding:8px;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join('')}</table>${buildCompanySignature()}`;
    const notification = await Notification.create({
      title: 'CRM data export',
      description: `${req.user.name || req.user.email || 'A CRM user'} exported ${filename || 'CRM data'} from ${section}. Reason: ${reason}`,
      tag: 'Data Export',
      kind: 'data_export_audit',
      createdBy: req.user._id,
      createdByName: req.user.name || req.user.email || 'CRM User',
      audience: admins.map(admin => admin._id).filter(Boolean),
      visibleToRoles: ['admin', 'superadmin'],
      metadata: { exportId: String(record._id), section, filename, reason, userEmail: req.user.email || '', exportedAt: record.createdAt }
    });
    record.status = 'authorized';
    record.notificationId = notification._id;
    record.recipientEmails = recipients;
    record.emailStatus = recipients.length ? 'pending' : 'failed';
    if (!recipients.length) record.emailErrors = ['No active administrator has an email address configured.'];
    await record.save();
    if (recipients.length) {
      void deliverExportEmail({ record, recipients, subject: `CRM export: ${section}`, html })
        .catch(error => console.error('[data-export-email-save]', { exportId: String(record._id), error: error.message }));
    }
    return res.json({ ok: true, exportId: record._id, notificationId: notification._id, emailStatus: record.emailStatus });
  } catch (error) { next(error); }
});
module.exports = router;
