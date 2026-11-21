const crypto = require('node:crypto');
const ReminderDelivery = require('../models/ReminderDelivery');
const legal = require('./legalSla');
const { userHasAnyRole } = require('../utils/userRoles');
const mailer = require('../utils/mailer');
let running = false;
let started = false;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function weeklySlot(now) {
  const india = new Date(+now + 330 * 60000);
  if (india.getUTCDay() !== 1 || india.getUTCHours() < 10) return null;
  return india.toISOString().slice(0, 10);
}
function recipientBatches(rows, users) {
  const pending = rows.filter(row => row.slaStatus === 'No');
  const batches = new Map();
  const add = (email, entries) => {
    email = String(email || '').trim().toLowerCase();
    if (!entries.length || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    if (!batches.has(email)) batches.set(email, new Map());
    entries.forEach(row => batches.get(email).set(row.id, row));
  };
  for (const user of users.filter(user => user.isActive !== false)) {
    add(user.email, userHasAnyRole(user, ['admin', 'superadmin']) ? pending : pending.filter(row => row.userId === String(user._id)));
  }
  add('legal@ananttattva.com', pending);
  return [...batches].map(([email, entries]) => ({ email, rows: [...entries.values()] }));
}
function emailHtml(rows) {
  return `<div style="font-family:Arial,sans-serif;color:#19344b;max-width:900px;margin:auto"><h1>Weekly Legal SLA follow-up</h1><p>The following clients have SLA Status No. Please collect and update their SLA in Client Master.</p><table style="width:100%;border-collapse:collapse"><thead><tr>${['Client Name', 'User Name', 'SLA Status'].map(label => `<th style="text-align:left;padding:12px;background:#eaf8f5">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${[row.clientName, row.userName, row.slaStatus].map(value => `<td style="padding:12px;border-bottom:1px solid #dfe9ef">${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table><p><a href="https://crmananttattva.com/legal">Open Legal SLA register</a></p><p>Reminders continue weekly while SLA remains No. A missing SLA status is treated as No until receipt is recorded.</p></div>`;
}
async function claim(key, now) {
  try { return await ReminderDelivery.create({ key, status: 'sending', leaseUntil: new Date(+now + 15 * 60000) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    return ReminderDelivery.findOneAndUpdate({ key, status: 'sending', leaseUntil: { $lte: now } }, { $set: { leaseUntil: new Date(+now + 15 * 60000) }, $inc: { attempts: 1 } }, { new: true });
  }
}
async function runLegalSlaReminders({ now = new Date(), dryRun = false } = {}) {
  const slot = weeklySlot(now);
  if (!slot || running) return { skipped: true, emails: 0 };
  running = true;
  try {
    const { rows, users } = await legal.loadLegalSla();
    const batches = recipientBatches(rows, users);
    if (dryRun) return { dryRun: true, recipients: batches.length, emails: 0 };
    let emails = 0, failures = 0;
    for (const batch of batches) {
      const key = `legal-sla:${slot}:${crypto.createHash('sha256').update(batch.email).digest('hex')}`;
      const delivery = await claim(key, now);
      if (!delivery) continue;
      try {
        // Recheck saved SLA and ownership immediately before sending; completed clients drop out.
        const fresh = await legal.loadLegalSla();
        const current = recipientBatches(fresh.rows, fresh.users).find(item => item.email === batch.email);
        if (!current) {
          await ReminderDelivery.deleteOne({ _id: delivery._id, status: 'sending' });
          continue;
        }
        await mailer.sendMail(batch.email, `Weekly Legal SLA reminder: ${current.rows.length} pending client(s)`, emailHtml(current.rows), { branded: false });
        await ReminderDelivery.updateOne({ _id: delivery._id }, { $set: { status: 'sent', sentAt: now } });
        emails++;
      } catch (error) {
        failures++;
        await ReminderDelivery.updateOne({ _id: delivery._id, status: 'sending' }, { $set: { leaseUntil: new Date(+now + 5 * 60000) } });
        console.warn('Legal SLA reminder pending retry', { code: error.code || 'MAIL_FAILED' });
      }
    }
    return { emails, failures };
  } finally { running = false; }
}
function startLegalSlaReminderScheduler() {
  if (started) return;
  started = true;
  const run = () => runLegalSlaReminders().catch(error => console.error('Legal SLA reminder scan failed', { code: error.code, name: error.name }));
  const first = setTimeout(run, 60000); first.unref?.();
  const timer = setInterval(run, 5 * 60000); timer.unref?.();
}
module.exports = { runLegalSlaReminders, startLegalSlaReminderScheduler, weeklySlot, recipientBatches, emailHtml };
