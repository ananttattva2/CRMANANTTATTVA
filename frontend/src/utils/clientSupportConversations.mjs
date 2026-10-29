const text = value => String(value || '').trim();
export function messageContactId(message, contacts = []) {
  if (message.recipient) return text(message.recipient).toLowerCase();
  const matches = contacts.filter(contact => contact.name === message.recipientName && contact.role === message.recipientRole);
  return matches.length === 1 ? matches[0].id : `history:${text(message.recipientName)}:${text(message.recipientRole)}`;
}
export function supportConversations(contacts, messages) {
  const entries = new Map(contacts.map(contact => [contact.id, { ...contact, active: true, messages: [] }]));
  for (const message of messages) {
    const id = messageContactId(message, contacts);
    if (!entries.has(id)) entries.set(id, { id, email: message.recipient || '', name: message.recipientName || 'Previous contact', role: message.recipientRole || 'Account team', active: false, messages: [] });
    entries.get(id).messages.push(message);
  }
  return [...entries.values()].map(conversation => {
    const sorted = [...conversation.messages].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
    return { ...conversation, messages: sorted, latest: sorted.at(-1) };
  }).sort((a,b) => Number(Boolean(b.latest)) - Number(Boolean(a.latest)) || new Date(b.latest?.createdAt || 0) - new Date(a.latest?.createdAt || 0) || a.name.localeCompare(b.name));
}
export function chatDayLabel(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier messages';
  const day = entry => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(entry);
  if (day(date) === day(now)) return 'Today';
  if (day(date) === day(new Date(now.getTime() - 86400000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
