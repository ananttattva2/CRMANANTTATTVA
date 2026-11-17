import { hasUploadTrackerClientProgress } from './uploadTrackerCompletion.mjs'

export function selectTrackerClients(users, selection) {
  if (!selection) return [];
  return users.filter(user => !selection.userId || user.userId === selection.userId).flatMap(user => user.clients.filter(client => selection.kind === 'progressed' || selection.kind === 'complete' ? hasUploadTrackerClientProgress(client) : selection.kind === 'stage' ? client[selection.module]?.[selection.index] === selection.state : true).map(client => ({ ...client, userName: user.userName })));
}
