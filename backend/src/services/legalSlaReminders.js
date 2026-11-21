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
  const body = rows.map((row, index) => `<tr>${[index + 1, row.clientName, row.userName, row.slaStatus].map(value => `<td style="padding:12px;border:1px solid #dfe9ef;vertical-align:top">${escape(value)}</td>`).join('')}</tr>`).join('');
  return `<html><body style="margin:0;background:#f3f7f8;font-family:Arial,sans-serif;color:#19344b"><table role="presentation" width="100%" cellspacing="0" cellpadding="24"><tr><td><h1 style="font-size:24px">Legal SLA — Pending Client List</h1><p>Sent by <strong>Krishna Yadav</strong></p><p><strong>${rows.length} client allocation(s)</strong> have SLA Status No. Please collect their SLA and update Client Master.</p><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fff;font-size:13px"><thead><tr>${['Sr. No.', 'Client Name', 'User Name', 'SLA Status'].map(label => `<th align="left" style="padding:12px;border:1px solid #cde5df;background:#eaf8f5">${label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table><p><a href="https://crmananttattva.com/legal">Open Legal SLA register</a></p><p>This email contains your complete pending list. Weekly follow-ups continue until SLA receipt is marked Yes.</p><p>Regards,<br><strong>Krishna Yadav</strong><br>Anant Tattva CRM</p></td></tr></table></body></html>`;
}
function currentWeekSlot(now) {
  const india = new Date(+now + 330 * 60000);
  india.setUTCDate(india.getUTCDate() - (india.getUTCDay() + 6) % 7);
  return india.toISOString().slice(0, 10);
}
async function claim(key, now) {
  try { return await ReminderDelivery.create({ key, status: 'sending', leaseUntil: new Date(+now + 15 * 60000) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    return ReminderDelivery.findOneAndUpdate({ key, status: 'sending', leaseUntil: { $lte: now } }, { $set: { leaseUntil: new Date(+now + 15 * 60000) }, $inc: { attempts: 1 } }, { new: true });
  }
}
async function runLegalSlaReminders({ now = new Date(), dryRun = false, sendNow = false } = {}) {
  const slot = sendNow ? currentWeekSlot(now) : weeklySlot(now);
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
        await mailer.sendMail(batch.email, `Weekly Legal SLA reminder: ${current.rows.length} pending client(s)`, emailHtml(current.rows), { branded: false, fromName: 'Krishna Yadav' });
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
module.exports = { runLegalSlaReminders, startLegalSlaReminderScheduler, weeklySlot, currentWeekSlot, recipientBatches, emailHtml };
