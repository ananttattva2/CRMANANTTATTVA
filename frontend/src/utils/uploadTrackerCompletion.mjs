const modules = ['purchase', 'sales']

export function isUploadTrackerClientComplete(client) {
  return modules.every(module => Array.isArray(client?.[module]) && client[module].length > 0 && client[module].every(state => state === 'complete'))
}

export function countCompletedUploadTrackerClients(clients = []) {
  return clients.filter(isUploadTrackerClientComplete).length
}
