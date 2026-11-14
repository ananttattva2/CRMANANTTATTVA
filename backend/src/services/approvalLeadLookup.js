// Prefer indexed identities. Mixing company regexes into the same $or forces
// a collection scan even when every approval already has a valid lead ID.
async function approvalLeads({ Lead, lookup, companies, projection, escapeRegex, matches }) {
  const read = filter => Lead.find(filter).select(projection).populate('createdBy', 'name email').maxTimeMS(15000).lean();
  const leads = lookup.length ? await read({ $or: lookup }) : [];
  const missingCompanies = [...new Set(companies.filter(company => company && !matches(leads, company)))];
  if (!missingCompanies.length) return leads;
  const fallback = await read({ $or: missingCompanies.map(company => ({ company: { $regex: `^${escapeRegex(company)}$`, $options: 'i' } })) });
  return [...new Map([...leads, ...fallback].map(lead => [String(lead._id), lead])).values()];
}
module.exports = { approvalLeads };
