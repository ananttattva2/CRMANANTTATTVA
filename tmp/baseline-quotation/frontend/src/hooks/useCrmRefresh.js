import { useEffect, useRef } from 'react'
import api from '../services/api'
import { subscribeCrmChanges } from '../services/crmFreshness'

export default function useCrmRefresh(refresh, enabled = true) {
  const current = useRef(refresh)
  const previousEnabled = useRef(enabled)
  current.current = refresh
  useEffect(() => {
    const resumed = enabled && !previousEnabled.current
    previousEnabled.current = enabled
    if (!enabled) return undefined
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
  }, [enabled])
}
