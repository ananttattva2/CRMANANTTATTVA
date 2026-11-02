const { createHash, randomUUID } = require('node:crypto');
const Client = require('../models/Client');
const User = require('../models/User');
const Delivery = require('../models/ConsentReminderDelivery');
const { sendMail } = require('../utils/mailer');
const { userHasAnyRole } = require('../utils/userRoles');
const { resolveClientMasterData, getAssignedServiceId, getCompanyName } = require('./clientMasterResolver');
const { clientMasterSourceRecordFilter } = require('./clientMasterVisibility');
let running = false;
let started = false;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
function dateKey(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) return '';
  const key = raw.slice(0, 10), date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : '';
}
function istToday(now = new Date()) {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
function reminderDate(validUntil) {
  const key = dateKey(validUntil);
  if (!key) return '';
  const date = new Date(`${key}T00:00:00Z`), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - 2);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
function emailAddresses(values) {
  return [...new Set(values.flatMap(value => String(value || '').split(/[;,\s]+/)).map(value => value.trim().toLowerCase()).filter(value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)))];
}
function consentEvents(client, today, includeOutsideWindow = false) {
  const events = new Map();
  const serviceIds = [...new Set([getAssignedServiceId(client), ...Object.keys(client.data?.serviceDetailsByAssignedServiceId || {})])];
  for (const serviceId of serviceIds) {
    const data = resolveClientMasterData(client, serviceId), cte = data.serviceDetailsByAssignedServiceId?.[serviceId]?.cte || data.cte || {};
    for (const [index, plant] of (Array.isArray(cte.plantWiseDetails) ? cte.plantWiseDetails : []).entries()) {
      for (const [kind, field, number] of [['CTE', 'cteValidDate', 'cteConsentNo'], ['CTO/CCA', 'ctoValidDate', 'ctoOrderNo']]) {
        if (kind === 'CTE' && String(cte.cteApplicable || '').toLowerCase() === 'no') continue;
        const expiry = dateKey(plant[field]), due = reminderDate(expiry);
        if (!due) continue;
        const eligible = today >= due && today <= expiry;
        if (!includeOutsideWindow && !eligible) continue;
        const companyName = getCompanyName(client) || 'Your organisation';
        const identity = client.companyIdentity || String(client.selectedLead?._id || client.selectedLead || client._id);
        const plantIdentity = String(plant[number] || plant.plantLocation || `plant-${index + 1}`).trim().toLowerCase();
        const eventKey = `${identity}|${plantIdentity}|${kind}|${expiry}`;
        const logicalKey = `${identity}|${String(plant.plantLocation || plant[number] || `plant-${index + 1}`).trim().toLowerCase()}|${kind}`;
        const contacts = emailAddresses([data.authorised?.email, ...(data.authorisedPersons || []).map(p => p.email), data.coordinating?.email, ...(data.coordinatingPersons || []).map(p => p.email), data.basic?.email, data.basic?.emails, client.selectedLead?.emails, data.selectedLeadSnapshot?.emails]);
        const existing = events.get(eventKey);
        events.set(eventKey, { eventKey, logicalKey, eligible, clientId: client._id, companyName, kind, validUntil: expiry, due, plant: plant.plantLocation || `Plant ${index + 1}`, consentNumber: plant[number] || 'Not recorded', contacts: emailAddresses([...(existing?.contacts || []), ...contacts]) });
      }
    }
  }
  return [...events.values()];
}
function consentEmail(event, today) {
  const days = Math.max(0, Math.round((new Date(`${event.validUntil}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000));
  const format = key => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric', timeZone:'UTC' });
  const timing = today === event.due ? 'Your consent validity ends in two months.' : `Your consent is within its two-month renewal window, with ${days} day${days === 1 ? '' : 's'} remaining.`;
  return {
    subject: `Renewal reminder: ${event.kind} consent expires on ${format(event.validUntil)} | ${event.companyName}`,
    html: `<div style="background:#f0f7f5;padding:28px 12px;font-family:Arial,sans-serif;color:#193b35"><div style="max-width:640px;margin:auto;background:white;border:1px solid #dcebe5;border-radius:18px;overflow:hidden"><div style="padding:28px;background:#087660;color:white"><p style="font-size:11px;letter-spacing:2px">ANANT TATTVA | CONSENT RENEWAL</p><h1 style="font-size:25px;margin:10px 0">Plan ahead. Keep your consent up to date.</h1></div><div style="padding:28px;line-height:1.7"><p>Dear Team,</p><p>This is a reminder that the <strong>${escape(event.kind)} consent</strong> for <strong>${escape(event.companyName)}</strong> is valid until <strong>${format(event.validUntil)}</strong>.</p><p>${timing}</p><table style="width:100%;background:#f3faf7;border-radius:12px;padding:16px;font-size:14px"><tr><td>Plant / Location</td><td><strong>${escape(event.plant)}</strong></td></tr><tr><td>Consent / Order Number</td><td><strong>${escape(event.consentNumber)}</strong></td></tr><tr><td>Valid Until</td><td><strong>${format(event.validUntil)}</strong></td></tr></table><p>Please review the consent conditions and coordinate the next steps with your CTE &amp; CTO/CCA team. Starting early gives you time to prepare the required documents and address any pending information.</p><p>If the consent has already been renewed, please update the validity date in Client Master so our records reflect the latest consent.</p><p>For assistance, please contact your Anant Tattva coordinator.</p><p>Kind regards,<br><strong>Anant Tattva Compliance Team</strong></p></div><div style="background:#f4f8f7;padding:16px 28px;color:#6c827a;font-size:12px">Automated consent-validity reminder. Please retain this message for your records.</div></div></div>`
  };
}
async function deliverOnce(event, recipient, today, { deliveries = Delivery, send = sendMail, now = new Date() } = {}) {
  const key = createHash('sha256').update(`${event.eventKey}|${recipient}`).digest('hex');
  await deliveries.updateOne({ key }, { $setOnInsert: { key, status:'pending', clientId:event.clientId, recipient, kind:event.kind, validUntil:event.validUntil } }, { upsert:true }).catch(error => { if (error.code !== 11000) throw error; });
  const claim = randomUUID();
  const record = await deliveries.findOneAndUpdate({ key, status: { $ne:'sent' }, $or:[{ leaseUntil:{ $exists:false } }, { leaseUntil:{ $lte:now } }] }, { $set:{ status:'sending', leaseUntil:new Date(now.getTime()+15*60000), claim } }, { new:true });
  if (!record) return false;
  try {
    const email = consentEmail(event, today);
    await send(recipient, email.subject, email.html, { branded:false });
    await deliveries.updateOne({ key, claim }, { $set:{ status:'sent', sentAt:new Date(), lastError:'' }, $unset:{ leaseUntil:1, claim:1 } });
    return true;
  } catch (error) {
    await deliveries.updateOne({ key, claim }, { $set:{ status:'pending', lastError:String(error.message || 'Delivery failed').slice(0,500) }, $unset:{ leaseUntil:1, claim:1 } });
    throw error;
  }
}
async function runConsentExpiryReminders(options = {}) {
  if (running) return { skipped:'already_running' };
  running = true;
  const result = { scanned:0, sent:0, errors:0, missingClientEmail:0 };
  try {
    const now = options.now || new Date(), today = istToday(now);
    const users = options.users || await User.find({ isActive:{ $ne:false } }).select('name email role roles isActive').lean();
    const staff = emailAddresses(users.filter(user => user.isActive !== false && userHasAnyRole(user, ['CTE & CTO', 'superadmin'])).map(user => user.email));
    const records = options.clients || Client.find(clientMasterSourceRecordFilter()).select('companyIdentity assignedServiceId selectedLead data.cte data.basic data.authorised.email data.authorisedPersons.email data.coordinating.email data.coordinatingPersons.email data.selectedLeadSnapshot.emails data.serviceDetailsByAssignedServiceId').populate('selectedLead','company emails').sort({ updatedAt:-1, _id:-1 }).lean().cursor({ batchSize:100 });
    const seen = new Set(), currentConsents = new Set();
    for await (const client of records) {
      result.scanned++;
      for (const event of consentEvents(client, today, true)) {
        if (currentConsents.has(event.logicalKey)) continue;
        currentConsents.add(event.logicalKey);
        if (!event.eligible) continue;
        if (!event.contacts.length) result.missingClientEmail++;
        for (const recipient of emailAddresses([...event.contacts, ...staff])) {
          const id = `${event.eventKey}|${recipient}`;
          if (seen.has(id)) continue; seen.add(id);
          try { if (await deliverOnce(event, recipient, today, { ...options, now })) result.sent++; }
          catch (error) { result.errors++; console.error('Consent expiry reminder delivery failed', String(event.clientId), event.kind, error.message); }
        }
      }
    }
    return result;
  } finally { running = false; }
}
function startConsentExpiryReminderScheduler() {
  if (started) return; started = true;
  const run = () => runConsentExpiryReminders().catch(error => console.error('Consent expiry reminder scan failed', error.message));
  setTimeout(run, 30000).unref();
  setInterval(run, 60*60*1000).unref();
}
module.exports = { dateKey, istToday, reminderDate, emailAddresses, consentEvents, consentEmail, deliverOnce, runConsentExpiryReminders, startConsentExpiryReminderScheduler };
