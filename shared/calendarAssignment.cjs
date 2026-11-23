function assigneesOf(item = {}) {
  const rows = Array.isArray(item.assignees) && item.assignees.length ? item.assignees : item.assignedToId || item.assignedToEmail || item.assignedTo ? [{ id: item.assignedToId || '', name: item.assignedToName || item.assignedTo || '', email: item.assignedToEmail || '' }] : [];
  const unique = new Map();
  rows.forEach(row => {
    if (!row || typeof row !== 'object') return;
    const clean = { id: String(row.id || row._id || '').trim(), name: String(row.name || '').trim(), email: String(row.email || '').trim().toLowerCase() };
    const key = (clean.id || clean.email || clean.name).toLowerCase();
    if (key && !unique.has(key)) unique.set(key, clean);
  });
  return [...unique.values()];
}
function assignmentTokens(item) { return assigneesOf(item).flatMap(row => [row.id, row.email, row.name]).map(value => value.toLowerCase()).filter(Boolean); }
function validReminderTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')); }
module.exports = { assigneesOf, assignmentTokens, validReminderTime };
