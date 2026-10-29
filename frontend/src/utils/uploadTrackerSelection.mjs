export function selectTrackerClients(users, selection) {
  if (!selection) return [];
  return users.filter(user => !selection.userId || user.userId === selection.userId).flatMap(user => user.clients.filter(client => selection.kind === 'sla' ? client.slaReceived === selection.received : selection.kind === 'stage' ? client[selection.module]?.[selection.index] === selection.state : true).map(client => ({ ...client, userName: user.userName })));
}
