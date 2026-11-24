const listeners = new Set()
let pollTimer
let pollPending = false
let revision
let readRevision
let lastRefresh = Date.now()
let generation = 0

export function getCrmGeneration() { return generation }

export function notifyCrmChanged(broadcast = true) {
  generation++
  lastRefresh = Date.now()
  for (const listener of listeners) listener()
  if (broadcast) {
    try { localStorage.setItem('crm:data:changed', `${Date.now()}:${Math.random()}`) } catch { /* Storage is optional. */ }
  }
}

async function poll() {
  if (pollPending || document.visibilityState === 'hidden' || !readRevision) return
  pollPending = true
  try {
    const result = await readRevision()
    const next = result.data?.revision
    if (next && revision && next !== revision) notifyCrmChanged(false)
    revision = next
    // Telemetry/time-dependent reports still refresh when no CRM record changes.
    if (Date.now() - lastRefresh >= 60000) notifyCrmChanged(false)
  } catch {
    if (Date.now() - lastRefresh >= 60000) notifyCrmChanged(false)
  } finally { pollPending = false }
}
function focus() { if (document.visibilityState !== 'hidden') { notifyCrmChanged(false); void poll() } }
function storage(event) { if (event.key === 'crm:data:changed') notifyCrmChanged(false) }

export function subscribeCrmChanges(listener, fetchRevision) {
  listeners.add(listener)
  readRevision = fetchRevision
  if (listeners.size === 1) {
    revision = undefined
    lastRefresh = Date.now()
    pollTimer = window.setInterval(poll, 5000)
    window.addEventListener('focus', focus)
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', focus)
    void poll()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    window.clearInterval(pollTimer)
    window.removeEventListener('focus', focus)
    window.removeEventListener('storage', storage)
    document.removeEventListener('visibilitychange', focus)
  }
}
