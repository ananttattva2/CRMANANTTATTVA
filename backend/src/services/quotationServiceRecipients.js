const User = require('../models/User');
function requiredServiceOwners(quotation = {}) {
  const owners = new Set();
  for (const item of quotation.items || []) {
    const text = [item.businessCategory, item.servicesOffered, item.serviceCategory, item.eprCategory, item.applicableService].flat().filter(Boolean).join(' ').replace(/[\u2010-\u2015_-]+/g, ' ');
    if (/\bsolid\s*waste\b/i.test(text)) owners.add('Suraj Shetty');
    else {
      if (/\bplastic\s*waste\b/i.test(text)) owners.add('TUSHAR GAWAS');
      if (/\bct[oe]\b/i.test(text)) owners.add('KSHITIJ TRIMUKHE');
    }
  }
  return ['KSHITIJ TRIMUKHE', 'TUSHAR GAWAS', 'Suraj Shetty'].filter(name => owners.has(name));
}
async function quotationServiceRecipients(quotation) {
  const names = requiredServiceOwners(quotation);
  if (!names.length) return [];
  const users = await User.find({ isActive: { $ne: false }, name: { $in: names.map(name => new RegExp('^\\s*' + name.split(/\s+/).join('\\s+') + '\\s*$', 'i')) } }).select('name email').lean();
  return [...new Set(users.map(user => String(user.email || '').trim().toLowerCase()).filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}
module.exports = { requiredServiceOwners, quotationServiceRecipients };
