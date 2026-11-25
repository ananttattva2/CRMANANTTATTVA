const modules = ['purchase', 'sales']

export function hasUploadTrackerClientProgress(client) {
  return modules.some(module => Array.isArray(client?.[module]) && client[module].some(state => state && state !== 'pending' && state !== 'notApplicable'))
}

export function countProgressedUploadTrackerClients(clients = []) {
  return clients.filter(hasUploadTrackerClientProgress).length
}
