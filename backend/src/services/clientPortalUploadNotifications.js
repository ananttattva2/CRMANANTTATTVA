const Lead = require('../models/Lead');
const { loadPortalData } = require('./clientPortal');
const User = require('../models/User');
const mailer = require('../utils/mailer');
const { closedServices } = require('./clientPortalApplicantTypes');
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function notifyUpload(row) {
  const lead = await Lead.findById(row.lead).lean();
  if (!lead) throw new Error('Company no longer available');
  const portal = await loadPortalData(row.uploadedBy);
  const company = portal.clients.find(client => String(client._id) === String(row.lead));
  const recipients = new Set();
  const add = value => { const email = String(value || '').trim().toLowerCase(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) recipients.add(email); };
  add(company?.spoc?.email);
  for (const assignment of company?.assignments || []) add(assignment.spoc?.email);
  const closures = closedServices(lead).filter(service => service.applicantType === row.applicantType);
  const closingPeople = lead.serviceSelections?.length > 1 ? closures : [lead, ...closures];
  for (const person of closingPeople) { add(person.closedByEmail); add(person.closedOnBehalfOfEmail); }
  const ids = closingPeople.flatMap(person => [person.closedBy, person.closedOnBehalfOfUser]).filter(Boolean);
  if (ids.length) for (const user of await User.find({ _id: { $in: ids } }).select('email').lean()) add(user.email);
  const superAdmins = await User.find({ isActive: { $ne: false }, $or: [{ role: /^super[\s_-]*admin$/i }, { roles: /^super[\s_-]*admin$/i }] }).select('email').lean();
  for (const admin of superAdmins) add(admin.email);
  if (!recipients.size) throw new Error('No account team email is configured');
  const subject = `${row.applicantType} data received â€” ${lead.company || 'Client company'}`;
  const details = [['Company', lead.company], ['Lead reference', lead.leadCode], ['Applicant Type', row.applicantType], ['Submitted by', row.uploadedBy], ['Excel file', row.name], ['Received on', new Date(row.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST']];
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#172338"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:30px 12px"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5eaf0;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 30px;border-bottom:1px solid #edf0f5"><strong style="color:#f26522;font-size:22px;letter-spacing:1px">ANANT TATTVA</strong><span style="display:block;color:#8592a6;font-size:11px;letter-spacing:2px;margin-top:6px">CLIENT PORTAL · DATA SUBMISSION</span></td></tr><tr><td style="padding:30px"><span style="display:inline-block;padding:7px 12px;background:#eaf9f1;color:#187654;border-radius:20px;font-size:12px;font-weight:bold">NEW EXCEL SUBMISSION</span><h1 style="font-size:27px;line-height:1.3;margin:18px 0 10px">Client data received</h1><p style="font-size:14px;line-height:1.7;color:#66768c;margin:0 0 22px">Dear Team,<br>The client has submitted an Excel file for <strong style="color:#253650">${escape(row.applicantType)}</strong>. The data is now available for your review.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5eaf0;border-radius:12px">${details.map(([key,value],index) => `<tr style="background:${index % 2 ? '#f8fafc' : '#ffffff'}"><td style="padding:13px 16px;color:#7b899c;font-size:12px;width:130px;border-bottom:1px solid #edf0f5">${escape(key)}</td><td style="padding:13px 16px;font-size:13px;font-weight:600;color:#263850;word-break:break-word;border-bottom:1px solid #edf0f5">${escape(value || 'Not recorded')}</td></tr>`).join('')}</table><table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0"><tr><td style="background:#f26522;border-radius:9px"><a href="${escape(row.url)}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none">Download submitted Excel &#8594;</a></td></tr></table><p style="padding:15px;border-left:3px solid #f26522;background:#fff7ed;color:#865333;font-size:13px;line-height:1.7">Please review the submitted information and coordinate any required follow-up with the client. Current processing stages are available in CRM under <strong>Client Data Uploads</strong>.</p><p style="font-size:13px;line-height:1.7;color:#66768c;margin-bottom:0">Regards,<br><strong style="color:#253650">Anant Tattva Client Portal</strong></p></td></tr><tr><td style="padding:18px 30px;background:#f8fafc;color:#97a2b2;font-size:11px;border-top:1px solid #edf0f5">Automated client submission notification · Anant Tattva</td></tr></table></td></tr></table></body></html>`;

  const results = await Promise.allSettled([...recipients].map(email => mailer.sendMail(email, subject, html)));
  return { sent: results.filter(result => result.status === 'fulfilled').length, failed: results.filter(result => result.status === 'rejected').length };
}
module.exports = { notifyUpload };
