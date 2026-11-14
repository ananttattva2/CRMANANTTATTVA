import { useEffect, useRef } from 'react'
import api from '../services/api'
import { subscribeCrmChanges } from '../services/crmFreshness'

export default function useCrmRefresh(refresh, enabled = true, initialLoading = false) {
  const current = useRef(refresh)
  const ready = useRef(!initialLoading)
  if (!initialLoading) ready.current = true
  const activeEnabled = enabled && ready.current
  const previousEnabled = useRef(activeEnabled)
  current.current = refresh
  useEffect(() => {
    const resumed = activeEnabled && !previousEnabled.current
    previousEnabled.current = activeEnabled
    if (!activeEnabled) return undefined
    let active = true
    let running = false
    let queued = false
    const reload = async () => {
      if (!active) return
      if (running) { queued = true; return }
      running = true
      try { await current.current() } catch { /* Page loader owns its error UI. */ }
      finally {
        running = false
        if (queued && active) { queued = false; void reload() }
      }
    }
    const unsubscribe = subscribeCrmChanges(reload, () => api.get('/cache/revision', { timeout: 10000 }))
    if (resumed) void reload()
    return () => { active = false; unsubscribe() }
  }, [activeEnabled])
}
