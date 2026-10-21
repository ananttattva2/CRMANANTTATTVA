export const COMMUNICATION_MODES = ['TeleCalling', 'Referral', 'Physical Visit', 'Campaign', 'Existing Client', 'Web Database', 'Webinar', 'Seminar', 'Exhibition', 'Associate Reference', 'Government', 'Call', 'Other / Not specified'];
const identity = value => String(value || '').trim().toLowerCase();
const entityId = value => typeof value === 'object' ? value?._id || value?.id : value;
export function communicationMode(value) {
  return COMMUNICATION_MODES.find(mode => identity(mode).replace(/\s/g, '') === identity(value).replace(/\s/g, '')) || 'Other / Not specified';
}
export function leadReviewRows(leads = [], temporaryLeads = []) {
  const seen = new Set();
  const owners = new Map();
  const rows = [];
  const add = (lead, temporary) => {
    if (temporary && lead.status !== 'DRAFT') return;
    const id = `${temporary ? 'temp' : 'lead'}:${lead._id || lead.id || lead.leadCode || lead.tempLeadCode}`;
    if (seen.has(id)) return;
    seen.add(id);
    const creator = typeof lead.createdBy === 'object' ? lead.createdBy : {};
    const name = String(lead.importedCreatedBy || lead.createdByName || creator?.name || lead.createdByEmail || creator?.email || 'Unknown user').trim();
    const declaredName = lead.importedCreatedBy || lead.createdByName;
    const creatorMatches = !declaredName || identity(creator?.name) === identity(declaredName);
    const aliases = [creatorMatches ? entityId(lead.createdBy) : '', lead.createdByCrmUserId, lead.createdByEmail, creatorMatches ? creator?.email : '', name].map(identity).filter(Boolean);
    // Resolve legacy text owners against populated creator identities.
    rows.push({ id, lead, temporary, ownerName: name, aliases,
      company: temporary ? lead.clientName : lead.company,
      code: temporary ? lead.tempLeadCode : lead.leadCode || lead.sourceLeadId,
      date: lead.createdAt || lead.importedCreatedAt || lead.leadDate || '',
      mode: temporary ? 'Other / Not specified' : communicationMode(lead.communicationMode),
      note: temporary ? lead.followUpRemarks || '' : [lead.communicationModeNote, lead.notes].filter(Boolean).filter((note, index, notes) => notes.indexOf(note) === index).join('\n')
    });
  };
  leads.forEach(lead => add(lead, false));
  temporaryLeads.forEach(lead => add(lead, true));
  // Union aliases before grouping so name/email-only legacy rows join current users.
  const parent = new Map();
  const root = key => { if (!parent.has(key)) parent.set(key, key); if (parent.get(key) !== key) parent.set(key, root(parent.get(key))); return parent.get(key); };
  rows.forEach(row => row.aliases.forEach(alias => parent.set(root(alias), root(row.aliases[0]))));
  rows.forEach(row => {
    const ownerKey = root(row.aliases[0]);
    if (!owners.has(ownerKey)) owners.set(ownerKey, row.ownerName);
    row.ownerKey = ownerKey;
    row.ownerName = owners.get(ownerKey);
  });
  return rows;
}
const indiaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export function reviewDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(indiaDate.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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
    const search = identity(filters.search);
    return !search || [row.company, row.code, row.ownerName, row.mode, row.note, row.lead.status].some(value => identity(value).includes(search));
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
