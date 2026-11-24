const Lead = require('../models/Lead');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');

async function runTemporaryAssignmentReminders() {
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const leads = await Lead.find({ 'assignments.temporaryUser.status': 'ACTIVE', 'assignments.temporaryUser.expiresAt': { $lte: soon } });
  let reminders = 0;
  for (const lead of leads) {
    const rows = (lead.assignments || []).map((row) => ({ ...(row || {}) }));
    let changed = false;
    for (let index = 0; index < rows.length; index += 1) {
      const temporary = rows[index].temporaryUser;
      if (temporary?.status !== 'ACTIVE' || !temporary.expiresAt || new Date(temporary.expiresAt) > soon || temporary.expiryReminderSentAt) continue;
      const expired = new Date(temporary.expiresAt) <= now;
      if (expired) temporary.status = 'EXPIRED';
      temporary.expiryReminderSentAt = now;
      rows[index].temporaryUser = temporary;
      changed = true;
      const manager = await User.findById(temporary.managerId).select('_id name email');
      if (manager) {
        const title = `${expired ? 'Temporary assignment expired' : 'Temporary assignment ends within 24 hours'}: ${lead.company || lead.leadCode}`;
        const description = `${temporary.temporaryUserName || 'Temporary user'} ${expired ? 'no longer has' : 'is about to lose'} temporary responsibility. Submit an extension request if more time is required.`;
        await Notification.create({ title, description, tag: 'Temporary Assignment', kind: 'lead_temporary_assignment_expiry', audience: [manager._id], visibleToRoles: ['manager'], metadata: { leadId: String(lead._id), rowIndex: index, expiresAt: temporary.expiresAt } });
        if (manager.email) await sendMail(manager.email, title, `<p>Hello ${manager.name || 'Manager'},</p><p>${description}</p><p>Regards,<br>IT Team</p>`, { branded: false }).catch(() => null);
        reminders += 1;
      }
    }
    if (changed) { lead.assignments = rows; lead.markModified('assignments'); await lead.save(); }
  }
  return { leads: leads.length, reminders };
}

function startTemporaryAssignmentReminderScheduler() {
  const run = () => runTemporaryAssignmentReminders().catch((error) => console.error('Temporary assignment reminder failed', error));
  run();
  setInterval(run, 60 * 60 * 1000);
}

module.exports = { runTemporaryAssignmentReminders, startTemporaryAssignmentReminderScheduler };
