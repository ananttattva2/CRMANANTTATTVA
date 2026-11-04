const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const DataExport = require('../models/DataExport');
const { sendMail } = require('../utils/mailer');
const { buildCompanySignature, getIntroductionLogoAttachment } = require('../services/leadIntroductionEmail');
const { escapeHtml } = require('../services/quotationDelivery');
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const reason = String(req.body.reason || '').trim();
    const section = String(req.body.section || '').trim();
    const filename = String(req.body.filename || '').trim().slice(0, 240);
    if (reason.length < 5 || reason.length > 2000 || !section || section.length > 200) return res.status(400).json({ error: 'Enter an export reason (5–2000 characters) and a valid section.' });
    const admins = await User.find({ isActive: true, $or: [{ role: { $in: ['admin', 'superadmin'] } }, { roles: { $in: ['admin', 'superadmin'] } }] }).select('email').lean();
    const recipients = [...new Set(admins.map(user => user.email).filter(Boolean))];
    if (!recipients.length) return res.status(503).json({ error: 'No active administrators are available for the export notification. Contact your admin.' });
    const record = await DataExport.create({ userId: req.user._id, userName: req.user.name, userEmail: req.user.email, section, filename, reason });
    const date = record.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'long' });
    const fields = { User: `${req.user.name || ''} (${req.user.email})`, Section: section, File: filename, Reason: reason, 'Date & time (IST)': date, 'Audit reference': String(record._id) };
    const html = `<h2>CRM data export</h2><p>The following user requested and was authorized to export data.</p><table>${Object.entries(fields).map(([key, value]) => `<tr><th align="left" style="padding:8px">${key}</th><td style="padding:8px;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join('')}</table>${buildCompanySignature()}`;
    const results = await Promise.allSettled(recipients.map(email => sendMail(email, `CRM export: ${section}`, html, { branded: false, attachments: [getIntroductionLogoAttachment()] })));
    record.notifiedEmails = recipients.filter((_, i) => results[i].status === 'fulfilled');
    record.status = results.every(result => result.status === 'fulfilled') ? 'authorized' : 'notification_failed';
    await record.save();
    if (record.status !== 'authorized') return res.status(503).json({ error: 'Admin notification could not be completed. Export was stopped; please retry.' });
    return res.json({ ok: true, exportId: record._id });
  } catch (error) { next(error); }
});
module.exports = router;
