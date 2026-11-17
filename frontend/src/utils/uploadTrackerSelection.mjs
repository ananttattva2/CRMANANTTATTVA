import { isUploadTrackerClientComplete } from './uploadTrackerCompletion.mjs'

export function selectTrackerClients(users, selection) {
  if (!selection) return [];
  return users.filter(user => !selection.userId || user.userId === selection.userId).flatMap(user => user.clients.filter(client => selection.kind === 'complete' ? isUploadTrackerClientComplete(client) : selection.kind === 'stage' ? client[selection.module]?.[selection.index] === selection.state : true).map(client => ({ ...client, userName: user.userName })));
}
