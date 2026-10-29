const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { contactEmailFilter, loadPortalData } = require('./clientPortal');
const { closedServices } = require('./clientPortalApplicantTypes');
async function portalContacts(email, leadId) {
  if (!mongoose.isValidObjectId(leadId)) return null;
  const lead = await Lead.findOne({ $and: [{ _id: leadId }, contactEmailFilter(email)] }).lean();
  if (!lead) return null;
  const contacts = new Map();
  const add = (address, name, role) => {
    const email = String(address || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const previous = contacts.get(email);
    contacts.set(email, { id: email, email, name: name || email, role: previous && previous.role !== role ? `${previous.role} / ${role}` : role });
  };
  const closures = closedServices(lead);
  const refs = [lead, ...closures];
  for (const row of refs) {
    add(row.closedByEmail, row.closedByText, 'Sales');
    add(row.closedOnBehalfOfEmail, row.closedOnBehalfOfName, 'Sales');
  }
  const ids = refs.flatMap(row => [row.closedBy, row.closedOnBehalfOfUser]).filter(value => mongoose.isValidObjectId(value));
  if (ids.length) for (const person of await User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select('name email').lean()) add(person.email, person.name, 'Sales');
  const data = await loadPortalData(email);
  const company = data.clients.find(row => String(row._id) === String(lead._id));
  for (const person of [company?.spoc, ...(company?.assignments || []).map(row => row.spoc)].filter(Boolean)) add(person.email, person.name, 'SPOC');
  add('it_support@ananttattva.com', 'IT Support', 'Technical support');
  add('it_admin@ananttattva.com', 'IT Admin', 'Technical support');
  return { lead, contacts: [...contacts.values()] };
}
module.exports = { portalContacts };
