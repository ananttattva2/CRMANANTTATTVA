export const COMMUNICATION_MODES = ['TeleCalling', 'Referral', 'Physical Visit', 'Campaign', 'Existing Client', 'Web Database', 'Webinar', 'Seminar', 'Exhibition', 'Associate Reference', 'Government', 'Call', 'Other / Not specified'];
const identity = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const entityId = value => typeof value === 'object' ? value?._id || value?.id : value;
export function communicationMode(value) {
  return COMMUNICATION_MODES.find(mode => identity(mode).replace(/\s/g, '') === identity(value).replace(/\s/g, '')) || 'Other / Not specified';
}
// Only account profiles establish aliases. Never union identity fields from a
// lead: its owner, editor and legacy importer can be three different people.
export function leadReviewRows(leads = [], temporaryLeads = []) {
  const profiles = new Map();
  const aliases = new Map();
  const profileId = profile => identity(entityId(profile));
  const addProfile = profile => {
    if (!profile || typeof profile !== 'object' || !profileId(profile)) return;
    const key = `user:${profileId(profile)}`;
    profiles.set(key, { key, name: profile.name || profile.email || 'Unknown user' });
    [profile._id, profile.id, profile.crmUserId, profile.email, profile.name].map(identity).filter(Boolean).forEach(alias => {
      if (!aliases.has(alias)) aliases.set(alias, key);
      else if (aliases.get(alias) !== key) aliases.set(alias, null);
    });
  };
  [...leads, ...temporaryLeads].forEach(lead => { addProfile(lead.generatedForUser); addProfile(lead.createdBy); });
  const ownerFor = (lead, temporary) => {
    const generated = !temporary && [lead.generatedForUser, lead.generatedForName, lead.generatedForEmail].some(Boolean);
    const profile = generated ? lead.generatedForUser : lead.createdBy;
    const object = profile && typeof profile === 'object' ? profile : {};
    const candidates = generated
      ? [entityId(profile), object.crmUserId, lead.generatedForEmail, object.email, lead.generatedForName, object.name]
      : [entityId(profile), lead.createdByCrmUserId, lead.createdByEmail, object.email, lead.createdByName, lead.importedCreatedBy, object.name];
    // When no explicit owner exists, imported names can identify the real
    // creator instead of the technical account used to upload old records.
    const declaredName = !generated && (lead.importedCreatedBy || lead.createdByName);
    const importedMismatch = declaredName && object.name && identity(declaredName) !== identity(object.name);
    const effective = importedMismatch
      ? [lead.createdByName, lead.importedCreatedBy, lead.createdByEmail]
      : candidates;
    for (const candidate of effective) {
      const key = aliases.get(identity(candidate));
      if (key) return profiles.get(key);
    }
    const name = generated
      ? object.name || lead.generatedForName || object.email || lead.generatedForEmail
      : lead.createdByName || lead.importedCreatedBy || object.name || lead.createdByEmail || object.email;
    // An unresolved explicit owner still stays separate from its creator.
    const id = !importedMismatch && entityId(profile);
    const key = id ? `user:${identity(id)}` : `legacy:${identity(name || effective.find(Boolean) || 'Unknown user')}`;
    return { key, name: String(name || 'Unknown user').trim() };
  };
  const seen = new Set();
  const rows = [];
  const add = (lead, temporary) => {
    if (temporary && lead.status !== 'DRAFT') return;
    const id = `${temporary ? 'temp' : 'lead'}:${lead._id || lead.id || lead.leadCode || lead.tempLeadCode}`;
    if (seen.has(id)) return;
    seen.add(id);
    const owner = ownerFor(lead, temporary);
    rows.push({ id, lead, temporary, ownerKey: owner.key, ownerName: owner.name,
      company: temporary ? lead.clientName : lead.company,
      code: temporary ? lead.tempLeadCode : lead.leadCode || lead.sourceLeadId,
      date: lead.createdAt || lead.importedCreatedAt || lead.leadDate || '',
      mode: temporary ? 'Other / Not specified' : communicationMode(lead.communicationMode),
      note: temporary ? lead.followUpRemarks || '' : [lead.communicationModeNote, lead.notes].filter(Boolean).filter((note, index, notes) => notes.indexOf(note) === index).join('\n')
    });
  };
  leads.forEach(lead => add(lead, false));
  temporaryLeads.forEach(lead => add(lead, true));
  return rows;
}
const indiaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export function reviewDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(indiaDate.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function matchesReviewSearch(row, query) {
  // Match the same full note shown in the table, including pasted line breaks,
  // non-breaking spaces and punctuation such as CTE/CTO or Importer + Seller.
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const text = [row.company, row.code, row.ownerName, row.mode, row.note, row.lead?.status].map(normalize).join(' ');
  return tokens.every(token => text.includes(token));
}
export function temporaryReviewRecords(temporaryLeads = []) {
  return temporaryLeads.filter(lead => lead.status === 'DRAFT').map(lead => ({
    ...lead, company: lead.clientName, leadCode: lead.tempLeadCode,
    importedCreatedBy: lead.createdBy?.name || lead.createdByName || lead.createdByEmail,
    __temporary: true, notes: lead.followUpRemarks || ''
  }));
}
export function filterReviewRows(rows, filters = {}, now = Date.now()) {
  return rows.filter(row => {
    if (filters.user && filters.user !== 'all' && row.ownerKey !== filters.user) return false;
    if (filters.mode && filters.mode !== 'all' && row.mode !== filters.mode) return false;
    if (filters.type === 'lead' && row.temporary || filters.type === 'temp' && !row.temporary) return false;
    const date = reviewDate(row.date);
    if (filters.from && (!date || date < filters.from)) return false;
    if (filters.to && (!date || date > filters.to)) return false;
    if (filters.days && filters.days !== 'all') {
      const elapsed = now - new Date(row.date).getTime();
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > Number(filters.days) * 86400000) return false;
    }
    if (filters.note === 'with' && !row.note.trim() || filters.note === 'without' && row.note.trim()) return false;
    return matchesReviewSearch(row, filters.search);
  });
}
export function summarizeReviewRows(rows) {
  const users = new Map();
  rows.forEach(row => {
    if (!users.has(row.ownerKey)) users.set(row.ownerKey, { key: row.ownerKey, name: row.ownerName, open: 0, temporary: 0, total: 0, modes: Object.fromEntries(COMMUNICATION_MODES.map(mode => [mode, 0])) });
    const user = users.get(row.ownerKey);
    user.total++;
    if (row.temporary) user.temporary++;
    else { user.open++; user.modes[row.mode]++; }
  });
  return [...users.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
