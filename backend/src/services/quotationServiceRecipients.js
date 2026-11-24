const User = require('../models/User');
function requiredServiceOwners(quotation = {}) {
  const text = (quotation.items || []).flatMap(item => [item.servicesOffered, item.serviceCategory, item.eprCategory, item.applicableService]).flat().filter(Boolean).join(' ');
  const names = [];
  if (/\bct[oe]\b|solid[\s-]*waste/i.test(text)) names.push('KSHITIJ TRIMUKHE');
  if (/solid[\s-]*waste/i.test(text)) names.push('Suraj Shetty');
  return names;
}
async function quotationServiceRecipients(quotation) {
  const names = requiredServiceOwners(quotation);
  if (!names.length) return [];
  const users = await User.find({ isActive: { $ne: false }, name: { $in: names.map(name => new RegExp('^\\s*' + name.split(/\s+/).join('\\s+') + '\\s*$', 'i')) } }).select('name email').lean();
  return [...new Set(users.map(user => String(user.email || '').trim().toLowerCase()).filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}
module.exports = { requiredServiceOwners, quotationServiceRecipients };
