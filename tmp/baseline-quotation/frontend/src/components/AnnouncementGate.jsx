import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCheck, Megaphone, RefreshCw, FileText } from 'lucide-react'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { formatDisplayDateTime } from '../utils/dateFormat'

export default function AnnouncementGate({ children }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const requestSequence = useRef(0)
  const checked = useRef(false)
  const buttonRef = useRef(null)
  const check = useCallback(async (required = false) => {
    const request = ++requestSequence.current
    try {
      const response = await api.get(API_ENDPOINTS.notifications.unreadAnnouncements)
      if (!Array.isArray(response.data?.announcements)) throw new Error('Unable to load announcements.')
      if (mounted.current && request === requestSequence.current) { checked.current = true; setItems(response.data.announcements); setError(''); setLoading(false) }
    } catch (failure) {
      if (mounted.current && request === requestSequence.current && (required || !checked.current)) { setError(failure.response?.data?.error || 'Announcements could not load. Please retry.'); setLoading(false) }
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    check()
    const timer = setInterval(() => check(), 60000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => { mounted.current = false; requestSequence.current += 1; clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [check])
  useEffect(() => { if (items.length) buttonRef.current?.focus() }, [items[0]?.id])
  const markRead = async () => {
    if (!items[0] || saving) return
    setSaving(true)
    setError('')
    try {
      await api.post(API_ENDPOINTS.notifications.markRead(items[0].id))
      // Fetch again after acknowledgement, including any newly published announcements.
      await check(true)
    } catch (failure) {
      if (failure.response?.status === 404) await check(true)
      else if (mounted.current) setError('Read confirmation could not be saved. Please retry.')
    } finally { if (mounted.current) setSaving(false) }
  }
  if (!loading && !items.length && !error) return children
  const item = items[0]
  const attachment = item?.attachmentUrl && /^(https?:\/\/|\/(?!\/))/.test(item.attachmentUrl) ? item.attachmentUrl : ''
  return createPortal(<div className="fixed inset-0 z-[30000] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-md" onKeyDown={(event) => {
    if (event.key === 'Escape') event.preventDefault()
    if (event.key === 'Tab') {
      const nodes = [...event.currentTarget.querySelectorAll('button:not(:disabled),a[href]')]
      const first = nodes[0], last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }}><section role="dialog" aria-modal="true" aria-labelledby="mandatory-announcement-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
    <header className="flex items-start gap-4 bg-gradient-to-r from-emerald-800 to-teal-700 px-6 py-6 text-white"><span className="rounded-2xl bg-white/15 p-3"><Megaphone className="h-7 w-7" /></span><div><p className="text-xs font-black uppercase tracking-widest text-emerald-100">Official announcement</p><h2 id="mandatory-announcement-title" className="mt-2 text-2xl font-black">{item?.title || 'Checking announcements'}</h2><p className="mt-2 text-sm text-emerald-100">Please read and acknowledge before continuing in CRM.</p></div></header>
    <div className="overflow-y-auto px-6 py-6">{loading ? <p role="status" className="font-semibold text-slate-500">Loading announcements…</p> : item && <><div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span className="rounded-full bg-amber-50 px-3 py-1 font-bold text-amber-800">{item.tag || 'General'}</span><span>{formatDisplayDateTime(item.createdAt)} · {item.createdBy}</span><span>{items.length} unread</span></div><p className="whitespace-pre-wrap break-words text-base leading-7 text-slate-700">{item.description}</p>{attachment && <div className="mt-5"><img src={attachment} alt={item.attachmentName || item.title} className="max-h-80 w-full rounded-xl border object-contain" onError={(event) => { event.currentTarget.style.display = 'none' }} /><a className="mt-3 inline-flex items-center gap-2 font-bold text-emerald-800" href={attachment} target="_blank" rel="noopener noreferrer"><FileText className="h-4 w-4" />View attachment</a></div>}</>}{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}</div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50 px-6 py-5"><p className="text-xs text-slate-500">Your read confirmation is saved to your CRM account.</p>{error && <button type="button" onClick={check} disabled={saving} className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 font-bold"><RefreshCw className="h-4 w-4" />Retry</button>}{item && <button ref={buttonRef} type="button" disabled={saving || loading} onClick={markRead} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white disabled:opacity-60"><CheckCheck className="h-5 w-5" />{saving ? 'Saving…' : 'Mark as Read & Continue'}</button>}</footer>
  </section></div>, document.body)
}
