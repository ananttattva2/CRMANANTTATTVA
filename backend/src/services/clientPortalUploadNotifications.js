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
  if (!recipients.size) throw new Error('No account team email is configured');
  const subject = `${row.applicantType} data received — ${lead.company || 'Client company'}`;
  const html = `<h2>Client data received</h2><p>Dear Team,</p><p>The client has submitted an Excel file for <strong>${escape(row.applicantType)}</strong>. The data is now available for your review.</p><table><tr><td><strong>Company</strong></td><td>${escape(lead.company)}</td></tr><tr><td><strong>Lead reference</strong></td><td>${escape(lead.leadCode)}</td></tr><tr><td><strong>Applicant Type</strong></td><td>${escape(row.applicantType)}</td></tr><tr><td><strong>Submitted by</strong></td><td>${escape(row.uploadedBy)}</td></tr><tr><td><strong>File</strong></td><td>${escape(row.name)}</td></tr></table><p><a href="${escape(row.url)}">Download the submitted Excel file</a></p><p>Please review the submitted information and coordinate any required follow-up with the client.</p><p>Regards,<br>Anant Tattva Client Portal</p>`;
  const results = await Promise.allSettled([...recipients].map(email => mailer.sendMail(email, subject, html)));
  return { sent: results.filter(result => result.status === 'fulfilled').length, failed: results.filter(result => result.status === 'rejected').length };
}
module.exports = { notifyUpload };
