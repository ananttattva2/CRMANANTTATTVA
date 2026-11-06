import React, { useEffect, useRef, useState } from 'react'
import { Mic, Phone, PhoneOff, Video } from 'lucide-react'
import api, { hasStoredAuthToken } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { getInternalCallRtcConfig, waitForInternalCallIce } from '../utils/internalCallRtc.mjs'

const userId = () => {
  try { const user = JSON.parse(localStorage.getItem('user') || '{}'); return String(user?._id || user?.id || '') } catch { return '' }
}
const initials = (value) => String(value || 'CRM').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

export default function InternalCallListener({ enabled = true }) {
  const [ticket, setTicket] = useState(null)
  const [state, setState] = useState('incoming')
  const [error, setError] = useState('')
  const peerRef = useRef(null)
  const streamRef = useRef(null)
  const audioRef = useRef(null)
  const toneRef = useRef(null)
  const pollingRef = useRef(false)

  function stopTone() {
    if (toneRef.current) window.clearInterval(toneRef.current)
    toneRef.current = null
  }

  function ring() {
    stopTone()
    const pulse = () => {
      try {
        const Context = window.AudioContext || window.webkitAudioContext
        if (!Context) return
        const context = new Context(); const oscillator = context.createOscillator(); const gain = context.createGain()
        oscillator.frequency.value = 760; gain.gain.value = .06; oscillator.connect(gain); gain.connect(context.destination); oscillator.start()
        window.setTimeout(() => { oscillator.stop(); context.close() }, 220)
      } catch { /* the visual incoming-call alert remains available */ }
    }
    pulse(); toneRef.current = window.setInterval(pulse, 1700)
  }

  function cleanup() {
    stopTone()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    peerRef.current?.close()
    streamRef.current = null; peerRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
  }

  function close() { cleanup(); setTicket(null); setState('incoming'); setError('') }

  useEffect(() => {
    if (!enabled || !('Notification' in window) || Notification.permission !== 'default') return undefined
    const request = () => Notification.requestPermission().catch(() => {})
    window.addEventListener('pointerdown', request, { once: true })
    return () => window.removeEventListener('pointerdown', request)
  }, [enabled])

  useEffect(() => {
    if (!enabled || !hasStoredAuthToken()) return undefined
    let cancelled = false
    const check = async () => {
      if (pollingRef.current || ticket) return
      pollingRef.current = true
      try {
        const { data } = await api.get(API_ENDPOINTS.internalTickets.incomingCall)
        const incoming = data.ticket && String(data.ticket.callSession?.initiatedBy) !== userId() ? data.ticket : null
        if (!cancelled && incoming) {
          setTicket(incoming); setState('incoming'); setError(''); ring()
          if ('Notification' in window && Notification.permission === 'granted') {
            const notice = new Notification(`${incoming.callSession?.mode === 'video' ? 'Video' : 'Audio'} call from ${incoming.callSession?.initiatedByName || 'CRM participant'}`, { body: `${incoming.ticketNumber} · ${incoming.subject}`, tag: `crm-call-${incoming._id}`, requireInteraction: true })
            notice.onclick = () => { window.focus(); notice.close() }
          }
        }
      } catch { /* ordinary API/session handling remains responsible for visible errors */ }
      finally { pollingRef.current = false }
    }
    check(); const timer = window.setInterval(check, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [enabled, ticket])

  useEffect(() => {
    if (!enabled) close()
    return undefined
  }, [enabled])

  useEffect(() => {
    if (!ticket?._id) return undefined
    let cancelled = false
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.get(API_ENDPOINTS.internalTickets.detail(ticket._id))
        const remoteStatus = data.ticket?.callSession?.status
        if (!cancelled && (['ended', 'rejected'].includes(remoteStatus) || (state === 'incoming' && remoteStatus !== 'ringing'))) close()
      } catch { /* keep active media while a transient status request retries */ }
    }, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [ticket?._id, state])

  useEffect(() => () => cleanup(), [])

  async function answer() {
    if (!ticket?.callSession?.offer) return setError('The incoming call offer is unavailable. Ask the caller to try again.')
    stopTone(); setState('connecting'); setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support secure CRM calls.')
      const mode = ticket.callSession.mode
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' })
      streamRef.current = stream
      const peer = new RTCPeerConnection(await getInternalCallRtcConfig())
      peerRef.current = peer
      stream.getTracks().forEach((track) => peer.addTrack(track, stream))
      peer.ontrack = (event) => { if (audioRef.current) { audioRef.current.srcObject = event.streams[0]; audioRef.current.play().catch(() => {}) } }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setState('active')
        if (['failed', 'disconnected'].includes(peer.connectionState)) setError('The media connection was interrupted. A TURN relay may be required for this network.')
      }
      await peer.setRemoteDescription(JSON.parse(ticket.callSession.offer))
      await peer.setLocalDescription(await peer.createAnswer())
      await waitForInternalCallIce(peer)
      const { data } = await api.patch(API_ENDPOINTS.internalTickets.call(ticket._id), { action: 'answer', answer: JSON.stringify(peer.localDescription) })
      setTicket(data.ticket); setState('active')
    } catch (callError) {
      cleanup(); setState('incoming')
      const denied = ['NotAllowedError', 'PermissionDeniedError'].includes(callError?.name)
      setError(denied ? 'Microphone or camera permission is blocked. Allow it in the browser address bar and try again.' : callError?.response?.data?.error || callError?.message || 'Unable to answer this call.')
    }
  }

  async function reject() {
    if (!ticket?._id) return close()
    try { await api.patch(API_ENDPOINTS.internalTickets.call(ticket._id), { action: 'reject' }) } catch { /* close locally even when signalling is unavailable */ }
    close()
  }

  async function end() {
    if (ticket?._id) { try { await api.patch(API_ENDPOINTS.internalTickets.call(ticket._id), { action: 'end' }) } catch { /* local cleanup must always run */ } }
    close()
  }

  if (!enabled || !ticket) return null
  const caller = ticket.callSession?.initiatedByName || 'CRM participant'
  const video = ticket.callSession?.mode === 'video'
  return <div className="fixed inset-0 z-[1400] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation">
    <section className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/20 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="global-call-title">
      <div className="bg-gradient-to-br from-emerald-700 to-teal-900 px-7 py-8 text-center text-white">
        <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white/15 text-2xl font-black ring-8 ring-white/5">{initials(caller)}</span>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[.2em] text-emerald-100">{state === 'incoming' ? 'Incoming CRM call' : state === 'connecting' ? 'Connecting' : 'Connected'}</p>
        <h2 id="global-call-title" className="mt-2 text-xl font-black">{caller}</h2>
        <p className="mt-1 text-sm font-semibold text-emerald-100">{ticket.ticketNumber} · {ticket.subject}</p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-black/15 px-4 py-2 text-xs font-bold">{video ? <Video className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{video ? 'Video call' : 'Audio call'}</div>
      </div>
      {error && <p className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-bold text-red-700" role="alert">{error}</p>}
      <footer className="flex items-center justify-center gap-8 p-6">
        {state === 'incoming' ? <><button type="button" onClick={reject} className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white shadow-lg transition hover:scale-105 hover:bg-red-600" aria-label="Reject call"><PhoneOff className="h-6 w-6" /></button><button type="button" onClick={answer} className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white shadow-lg transition hover:scale-105 hover:bg-emerald-600" aria-label="Answer call"><Phone className="h-6 w-6" /></button></> : <button type="button" onClick={end} className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-600" aria-label="End call"><PhoneOff className="h-6 w-6" /></button>}
      </footer>
      <audio ref={audioRef} autoPlay />
    </section>
  </div>
}
