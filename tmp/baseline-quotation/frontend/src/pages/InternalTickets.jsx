import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CheckCircle2, Circle, Download, Eye, FileText, Folder, Loader2, MessageSquareText, Mic, MoreHorizontal, Paperclip, Phone, Plus, Search, Send, Settings, ShieldCheck, Smile, Users, Video, X } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { uploadMediaBatch } from '../services/mediaUpload'

const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed']
const emptyDraft = { subject: '', priority: 'Medium', participants: [], message: '', attachments: [] }
const stamp = (value) => value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'
const initials = (value) => String(value || 'CRM User').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
const fileUrl = (file) => String(file?.url || file?.secureUrl || '')
const EMOJIS = ['😀', '😂', '😍', '👍', '👏', '🎉', '✅', '🙏', '🔥', '💯', '🤝', '📌']
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] }
const waitForIce = (peer) => new Promise((resolve) => { if (peer.iceGatheringState === 'complete') return resolve(); const done = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', done); resolve() } }; peer.addEventListener('icegatheringstatechange', done); setTimeout(resolve, 5000) })

async function downloadInternalTicketFile(file) {
  const response = await api.get(API_ENDPOINTS.internalTickets.downloadAttachment, { params: { url: fileUrl(file) }, responseType: 'blob' })
  const objectUrl = URL.createObjectURL(response.data)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = file.name || 'attachment'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function AttachmentList({ items = [], onPreview, onDownload = downloadInternalTicketFile }) {
  if (!items.length) return null
  return <div className="teams-attachments">{items.map((file, index) => {
    const image = String(file.type || '').startsWith('image/')
    const url = fileUrl(file)
    return <div key={`${url}-${index}`} className="teams-attachment">
      {image ? <img src={url} alt={file.name || 'Attachment'} /> : <span><FileText /></span>}
      <div><strong>{file.name || 'Attachment'}</strong><small>{file.size ? `${Math.ceil(file.size / 1024)} KB` : 'Open attachment'}</small></div>
      <button type="button" onClick={() => onPreview?.({ ...file, url })} title="Preview"><Eye /></button><button type="button" onClick={() => onDownload?.({ ...file, url }).catch(() => window.alert('Unable to download this attachment.'))} title="Download"><Download /></button>
    </div>
  })}</div>
}

function StatusBadge({ status }) {
  return <span className={`teams-status teams-status-${String(status).toLowerCase().replace(/\s+/g, '-')}`}><i />{status}</span>
}

function ConversationRow({ ticket, active, onSelect }) {
  const owner = ticket.createdBy?.name || 'CRM User'
  const last = ticket.messages?.[ticket.messages.length - 1]
  return <button type="button" onClick={onSelect} className={`teams-conversation-row ${active ? 'is-active' : ''}`}>
    <span className="teams-avatar">{initials(owner)}<i /></span>
    <span className="teams-conversation-copy"><span><strong>{ticket.subject}</strong><time>{stamp(ticket.lastMessageAt)}</time></span><small>{last?.authorName || owner}: {last?.message || (last?.attachments?.length ? 'Shared an attachment' : ticket.ticketNumber)}</small><span className="teams-row-meta"><b>{ticket.ticketNumber}</b><StatusBadge status={ticket.status} /></span></span>
  </button>
}

function EmptyConversation() {
  return <div className="teams-empty"><span><MessageSquareText /></span><h2>Select a ticket conversation</h2><p>Choose a conversation from the left to start collaborating with your team.</p></div>
}

export default function InternalTickets() {
  const currentUser = JSON.parse(localStorage.getItem('user') || 'null')
  const isAdmin = ['admin', 'superadmin'].includes(String(currentUser?.role || '').toLowerCase())
  const [tickets, setTickets] = useState([])
  const [users, setUsers] = useState([])
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [reply, setReply] = useState('')
  const [replyFiles, setReplyFiles] = useState([])
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [scope, setScope] = useState('mine')
  const [statusView, setStatusView] = useState('Open')
  const [appView, setAppView] = useState('chat')
  const [chatTab, setChatTab] = useState('chat')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState(null)
  const [callMode, setCallMode] = useState('')
  const [callError, setCallError] = useState('')
  const [callStatus, setCallStatus] = useState('')
  const [compactMode, setCompactMode] = useState(false)
  const messageEndRef = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const peerRef = useRef(null)
  const audioContextRef = useRef(null)
  const ringtoneTimerRef = useRef(null)
  const titleTimerRef = useRef(null)
  const originalTitleRef = useRef(document.title)

  async function load(nextScope = scope) {
    setLoading(true)
    try {
      const [ticketRes, userRes] = await Promise.all([api.get(API_ENDPOINTS.internalTickets.list, { params: nextScope === 'all' ? { scope: 'all' } : {} }), api.get(API_ENDPOINTS.internalTickets.participants)])
      const nextTickets = ticketRes.data.tickets || []
      setTickets(nextTickets)
      setUsers((userRes.data.users || []).filter((user) => String(user._id || user.id) !== String(currentUser?._id || currentUser?.id)))
      setSelected((active) => active ? nextTickets.find((item) => item._id === active._id) || null : null)
    } catch (err) { setError(err?.response?.data?.error || 'Unable to load internal tickets.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load(scope) }, [scope])
  useEffect(() => { messageEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [selected?.messages?.length])
  useEffect(() => {
    const unlockAudio = () => {
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
      audioContextRef.current.resume?.()
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    }
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    return () => { window.removeEventListener('pointerdown', unlockAudio); stopRingtone(); mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); peerRef.current?.close(); audioContextRef.current?.close?.() }
  }, [])
  useEffect(() => {
    if (!callMode.startsWith('incoming')) return undefined
    startRingtone()
    const caller = selected?.callSession?.initiatedByName || 'CRM participant'
    if ('Notification' in window && Notification.permission === 'granted') {
      const notice = new Notification(`${callMode.includes('video') ? 'Video' : 'Audio'} call from ${caller}`, { body: `${selected?.ticketNumber || 'Internal ticket'} · Click to answer`, tag: `internal-call-${selected?._id}`, requireInteraction: true })
      notice.onclick = () => { window.focus(); notice.close() }
      return () => { notice.close(); stopRingtone() }
    }
    return stopRingtone
  }, [callMode, selected?._id])
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get(API_ENDPOINTS.internalTickets.list, { params: scope === 'all' ? { scope: 'all' } : {} })
        const nextTickets = data.tickets || []
        setTickets(nextTickets)
        const ringing = nextTickets.find((ticket) => ticket.callSession?.status === 'ringing' && String(ticket.callSession.initiatedBy) !== String(currentUser?._id || currentUser?.id))
        if (ringing && !callMode) { setSelected(ringing); setStatusView(ringing.status); setAppView('chat'); setCallMode(`incoming-${ringing.callSession.mode}`); setCallStatus('Incoming call') }
      } catch { /* regular page loading handles visible errors */ }
    }, 2500)
    return () => clearInterval(timer)
  }, [scope, callMode])
  useEffect(() => {
    if (!callMode || callMode.startsWith('incoming') || !selected?._id) return undefined
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get(API_ENDPOINTS.internalTickets.detail(selected._id))
        const session = data.ticket?.callSession
        setSelected(data.ticket)
        if (session?.status === 'active' && session.answer && peerRef.current && !peerRef.current.currentRemoteDescription) { await peerRef.current.setRemoteDescription(JSON.parse(session.answer)); setCallStatus('Connected') }
        if (['rejected', 'ended'].includes(session?.status)) endCall(false)
      } catch { /* keep the current call UI while retrying */ }
    }, 1500)
    return () => clearInterval(timer)
  }, [callMode, selected?._id])

  const counts = useMemo(() => Object.fromEntries(STATUSES.map((status) => [status, tickets.filter((ticket) => ticket.status === status).length])), [tickets])
  const visible = useMemo(() => tickets.filter((ticket) => {
    const haystack = [ticket.ticketNumber, ticket.subject, ticket.createdBy?.name, ...(ticket.participants || []).map((user) => user.name)].join(' ').toLowerCase()
    return ticket.status === statusView && haystack.includes(search.trim().toLowerCase())
  }), [tickets, search, statusView])
  const searchUsers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query.length < 2) return []
    return users.filter((user) => [user.name, user.email, user.role].join(' ').toLowerCase().includes(query)).slice(0, 8)
  }, [users, search])
  const searchTickets = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (query.length < 2) return []
    return tickets.filter((ticket) => [ticket.subject, ticket.ticketNumber, ticket.createdBy?.name].join(' ').toLowerCase().includes(query)).slice(0, 8)
  }, [tickets, search])
  const sharedFiles = useMemo(() => (selected?.messages || []).flatMap((message) => (message.attachments || []).map((file) => ({ ...file, sender: message.authorName, sentAt: message.createdAt }))), [selected])
  const allFiles = useMemo(() => tickets.flatMap((ticket) => (ticket.messages || []).flatMap((message) => (message.attachments || []).map((file) => ({ ...file, ticketNumber: ticket.ticketNumber, subject: ticket.subject, sender: message.authorName, sentAt: message.createdAt })))), [tickets])

  async function upload(event, target) {
    const files = Array.from(event.target.files || []); event.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      const uploaded = await uploadMediaBatch(files.slice(0, 8), 'crm/internal-tickets')
      target === 'draft' ? setDraft((current) => ({ ...current, attachments: [...current.attachments, ...uploaded] })) : setReplyFiles((current) => [...current, ...uploaded])
    } catch (err) { setError(err.message || 'Attachment upload failed.') }
    finally { setUploading(false) }
  }

  async function create(event) {
    event.preventDefault()
    if (!draft.participants.length) return setError('Select at least one participant for this private conversation.')
    setSaving(true)
    try {
      const { data } = await api.post(API_ENDPOINTS.internalTickets.create, draft)
      setScope('mine'); setStatusView('Open'); setTickets((current) => [data.ticket, ...current]); setSelected(data.ticket); setDraft(emptyDraft); setCreating(false)
    } catch (err) { setError(err?.response?.data?.error || 'Unable to create internal ticket.') }
    finally { setSaving(false) }
  }

  async function update(payload) {
    if (!selected) return
    setSaving(true)
    try {
      const { data } = await api.put(API_ENDPOINTS.internalTickets.detail(selected._id), payload)
      setTickets((current) => current.map((item) => item._id === data.ticket._id ? data.ticket : item)); setSelected(data.ticket); setReply(''); setReplyFiles([])
      if (payload.status) setStatusView(payload.status)
    } catch (err) { setError(err?.response?.data?.error || 'Unable to update internal ticket.') }
    finally { setSaving(false) }
  }

  function sendReply() { if (reply.trim() || replyFiles.length) update({ message: reply, attachments: replyFiles }) }
  function onComposerKeyDown(event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendReply() } }
  function openUserChat(user) { const id = String(user._id || user.id); setDraft({ ...emptyDraft, subject: user.name || user.email, participants: [id] }); setCreating(true); setSearch('') }
  async function createPeer(stream) {
    const peer = new RTCPeerConnection(RTC_CONFIG)
    stream.getTracks().forEach((track) => peer.addTrack(track, stream))
    peer.ontrack = (event) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0] }
    peer.onconnectionstatechange = () => { if (peer.connectionState === 'connected') setCallStatus('Connected'); if (['failed', 'disconnected'].includes(peer.connectionState)) setCallStatus('Connection interrupted') }
    peerRef.current = peer
    return peer
  }
  function playRingPulse() {
    const context = audioContextRef.current
    if (!context || context.state !== 'running') return
    ;[0, .22].forEach((delay) => {
      const oscillator = context.createOscillator(); const gain = context.createGain(); const now = context.currentTime + delay
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(660, now); oscillator.frequency.setValueAtTime(880, now + .1)
      gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(.16, now + .02); gain.gain.exponentialRampToValueAtTime(.0001, now + .18)
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + .2)
    })
  }
  function startRingtone() {
    stopRingtone(); playRingPulse(); ringtoneTimerRef.current = setInterval(playRingPulse, 1600)
    titleTimerRef.current = setInterval(() => { document.title = document.title.startsWith('Incoming call') ? originalTitleRef.current : `Incoming call · ${selected?.callSession?.initiatedByName || 'Internal Teams'}` }, 800)
  }
  function stopRingtone() {
    if (ringtoneTimerRef.current) clearInterval(ringtoneTimerRef.current)
    if (titleTimerRef.current) clearInterval(titleTimerRef.current)
    ringtoneTimerRef.current = null; titleTimerRef.current = null; document.title = originalTitleRef.current
  }
  async function startCall(mode) {
    if (!selected) return
    setCallError(''); setCallMode(mode); setCallStatus('Starting call...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' })
      mediaStreamRef.current = stream
      const peer = await createPeer(stream)
      await peer.setLocalDescription(await peer.createOffer()); await waitForIce(peer)
      await api.patch(API_ENDPOINTS.internalTickets.call(selected._id), { action: 'start', mode, offer: JSON.stringify(peer.localDescription) })
      setCallStatus('Ringing participants...')
      setTimeout(() => { if (localVideoRef.current) localVideoRef.current.srcObject = stream }, 0)
    } catch (error) { setCallError(error?.response?.data?.error || 'Microphone/camera permission was denied or the call could not start.'); setCallStatus('Call failed') }
  }
  async function answerCall() {
    const session = selected?.callSession; const mode = session?.mode
    if (!session?.offer) return
    stopRingtone(); setCallMode(mode); setCallStatus('Connecting...'); setCallError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === 'video' }); mediaStreamRef.current = stream
      const peer = await createPeer(stream); await peer.setRemoteDescription(JSON.parse(session.offer)); await peer.setLocalDescription(await peer.createAnswer()); await waitForIce(peer)
      const { data } = await api.patch(API_ENDPOINTS.internalTickets.call(selected._id), { action: 'answer', answer: JSON.stringify(peer.localDescription) }); setSelected(data.ticket); setCallStatus('Connected')
      setTimeout(() => { if (localVideoRef.current) localVideoRef.current.srcObject = stream }, 0)
    } catch (error) { setCallError(error?.response?.data?.error || 'Unable to answer the call.'); setCallStatus('Call failed') }
  }
  async function rejectCall() { stopRingtone(); try { await api.patch(API_ENDPOINTS.internalTickets.call(selected._id), { action: 'reject' }) } finally { endCall(false) } }
  async function endCall(notify = true) {
    if (notify && selected?._id) { try { await api.patch(API_ENDPOINTS.internalTickets.call(selected._id), { action: 'end' }) } catch { /* local cleanup must always run */ } }
    stopRingtone(); mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); peerRef.current?.close(); mediaStreamRef.current = null; peerRef.current = null; setCallMode(''); setCallError(''); setCallStatus('')
  }

  return <DashboardShell currentUser={currentUser}>
    <div className="teams-page" aria-label="Internal Tickets & Team Chat">
      <header className="teams-topbar"><div className="teams-product"><span><Users /></span><strong>Internal Teams</strong></div><div className="teams-search-wrap"><div className="teams-global-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users, tickets and messages" />{search && <button onClick={() => setSearch('')}><X /></button>}</div>{search.trim().length >= 2 && <div className="teams-search-results"><div className="teams-search-chips"><span>People</span><span>Messages</span><span>Files</span></div>{searchUsers.map((user) => <button key={user._id || user.id} onClick={() => openUserChat(user)}><span className="teams-avatar">{initials(user.name || user.email)}<i /></span><div><strong>{user.name || user.email}</strong><small>{user.role || 'CRM User'} · {user.email}</small></div><MessageSquareText /></button>)}{searchTickets.map((ticket) => <button key={ticket._id} onClick={() => { setSelected(ticket); setStatusView(ticket.status); setAppView('chat'); setSearch('') }}><span className="teams-search-ticket"><FileText /></span><div><strong>{ticket.subject}</strong><small>{ticket.ticketNumber} · {ticket.status}</small></div><Search /></button>)}{!searchUsers.length && !searchTickets.length && <p>No matching users or tickets found.</p>}</div>}</div></header>
      {error && <div className="teams-error">{error}<button onClick={() => setError('')}><X /></button></div>}
      <section className="teams-shell">
        <nav className="teams-app-rail" aria-label="Internal collaboration navigation"><button className={appView === 'activity' ? 'is-active' : ''} onClick={() => setAppView('activity')} title="Activity"><Activity /><span>Activity</span></button><button className={appView === 'chat' ? 'is-active' : ''} onClick={() => setAppView('chat')} title="Chat"><MessageSquareText /><span>Chat</span></button><button className={appView === 'files' ? 'is-active' : ''} onClick={() => setAppView('files')} title="Files"><Folder /><span>Files</span></button><button className={appView === 'settings' ? 'is-active' : ''} onClick={() => setAppView('settings')} title="Settings"><Settings /><span>Settings</span></button></nav>
        <aside className="teams-sidebar">
          <div className="teams-sidebar-title"><div><small>Workspace</small><h2>Internal Tickets</h2></div><button onClick={() => setCreating(true)} title="New internal ticket"><Plus /></button></div>
          <div className="teams-scope-tabs"><button className={scope === 'mine' ? 'is-active' : ''} onClick={() => setScope('mine')}>My chats</button>{isAdmin && <button className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}><ShieldCheck /> Oversight</button>}</div>
          <div className="teams-quick-title">Quick views</div><div className="teams-status-list">{STATUSES.map((status) => <button key={status} className={statusView === status ? 'is-active' : ''} onClick={() => { setStatusView(status); setSelected(null) }}>{status === 'Resolved' || status === 'Closed' ? <CheckCircle2 /> : <Circle />}<span>{status}</span><b>{counts[status] || 0}</b></button>)}</div>
          <div className="teams-chat-heading"><span>Ticket chats</span><button onClick={() => load()} title="Refresh"><MoreHorizontal /></button></div>
          <div className="teams-conversation-list">{loading ? <div className="teams-loading"><Loader2 /></div> : visible.length ? visible.map((ticket) => <ConversationRow key={ticket._id} ticket={ticket} active={selected?._id === ticket._id} onSelect={() => setSelected(ticket)} />) : <div className="teams-list-empty">No {statusView.toLowerCase()} tickets found.</div>}</div>
        </aside>
        <main className="teams-workspace">{appView === 'activity' ? <section className="teams-module-page"><header><Activity /><div><h2>Activity</h2><p>Recent ticket updates across your internal workspace.</p></div></header><div className="teams-activity-feed">{tickets.slice(0, 30).map((ticket) => <button key={ticket._id} onClick={() => { setSelected(ticket); setStatusView(ticket.status); setAppView('chat') }}><span className="teams-avatar">{initials(ticket.createdBy?.name)}</span><div><strong>{ticket.subject}</strong><p><b>{ticket.createdBy?.name || 'CRM User'}</b> updated {ticket.ticketNumber}</p><small>{stamp(ticket.lastMessageAt)}</small></div><StatusBadge status={ticket.status} /></button>)}</div></section> : appView === 'files' ? <section className="teams-module-page"><header><Folder /><div><h2>Files</h2><p>Every attachment shared in ticket conversations.</p></div></header><div className="teams-file-grid">{allFiles.length ? allFiles.map((file, index) => <div key={`${fileUrl(file)}-${index}`}><AttachmentList items={[file]} onPreview={setPreviewFile} /><p>{file.ticketNumber} · {file.subject}</p><small>{file.sender} · {stamp(file.sentAt)}</small></div>) : <div className="teams-module-empty">No files have been shared yet.</div>}</div></section> : appView === 'settings' ? <section className="teams-module-page teams-settings-page"><header><Settings /><div><h2>Settings</h2><p>Personalize your Internal Teams experience.</p></div></header><div className="teams-settings-card"><h3>Appearance</h3><label><span><strong>Compact conversation mode</strong><small>Reduce spacing to show more ticket chats.</small></span><input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} /></label><label><span><strong>Message notifications</strong><small>Show CRM notifications for new internal messages.</small></span><input type="checkbox" defaultChecked /></label><label><span><strong>Attachment previews</strong><small>Open supported images and PDFs inside the workspace.</small></span><input type="checkbox" defaultChecked /></label></div><div className="teams-settings-card"><h3>Privacy and access</h3><p>Only the ticket creator, selected participants, and authorized oversight users can access a conversation.</p><span><ShieldCheck /> Protected by CRM authentication</span></div></section> : !selected ? <EmptyConversation /> : <>
          <header className="teams-chat-header"><span className="teams-avatar teams-avatar-lg">{initials(selected.subject)}<i /></span><div className="teams-chat-identity"><small>{selected.ticketNumber}</small><h2>{selected.subject}</h2><p><Users />{[selected.createdBy, ...(selected.participants || [])].map((user) => user?.name).filter(Boolean).join(', ')}</p></div><div className="teams-chat-actions"><button title="Audio call" onClick={() => startCall('audio')}><Phone /></button><button title="Video call" onClick={() => startCall('video')}><Video /></button><StatusBadge status={selected.status} /><select aria-label="Ticket status" value={selected.status} onChange={(event) => update({ status: event.target.value })}>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select><button title="More options"><MoreHorizontal /></button></div></header>
          <div className="teams-chat-tabs"><button className={chatTab === 'chat' ? 'is-active' : ''} onClick={() => setChatTab('chat')}>Chat</button><button className={chatTab === 'shared' ? 'is-active' : ''} onClick={() => setChatTab('shared')}>Shared</button><button className={chatTab === 'details' ? 'is-active' : ''} onClick={() => setChatTab('details')}>Details</button></div>
          {chatTab === 'shared' ? <div className="teams-tab-panel"><h3>Shared files</h3><p>Documents and images shared in this ticket.</p><div className="teams-file-grid">{sharedFiles.length ? sharedFiles.map((file, index) => <div key={`${fileUrl(file)}-${index}`}><AttachmentList items={[file]} onPreview={setPreviewFile} /><small>{file.sender} · {stamp(file.sentAt)}</small></div>) : <div className="teams-module-empty">No files have been shared in this chat.</div>}</div></div> : chatTab === 'details' ? <div className="teams-tab-panel teams-details-panel"><h3>Ticket details</h3><dl><div><dt>Ticket number</dt><dd>{selected.ticketNumber}</dd></div><div><dt>Status</dt><dd><StatusBadge status={selected.status} /></dd></div><div><dt>Priority</dt><dd>{selected.priority}</dd></div><div><dt>Created by</dt><dd>{selected.createdBy?.name || '-'}</dd></div><div><dt>Created</dt><dd>{stamp(selected.createdAt)}</dd></div><div><dt>Last activity</dt><dd>{stamp(selected.lastMessageAt)}</dd></div></dl><h3>Participants</h3><div className="teams-participant-grid">{[selected.createdBy, ...(selected.participants || [])].filter(Boolean).map((user, index) => <div key={user._id || index}><span className="teams-avatar">{initials(user.name || user.email)}<i /></span><span><strong>{user.name || user.email}</strong><small>{user.role || 'CRM User'}</small></span></div>)}</div></div> : <><div className={`teams-messages ${compactMode ? 'is-compact' : ''}`}><div className="teams-date-divider"><span>Ticket conversation</span></div>{(selected.messages || []).map((message, index) => { const mine = String(message.author) === String(currentUser?._id || currentUser?.id); return <article key={message._id || index} className={`teams-message ${mine ? 'is-mine' : ''}`}>{!mine && <span className="teams-avatar">{initials(message.authorName)}</span>}<div className="teams-message-content"><header><strong>{message.authorName || 'CRM User'}</strong><time>{stamp(message.createdAt)}</time></header><div className="teams-message-bubble">{message.message && <p>{message.message}</p>}<AttachmentList items={message.attachments} onPreview={setPreviewFile} /></div></div></article> })}<div ref={messageEndRef} /></div>
          <footer className="teams-composer"><AttachmentList items={replyFiles} onPreview={setPreviewFile} /><div className="teams-compose-box"><textarea value={reply} onChange={(event) => setReply(event.target.value)} onKeyDown={onComposerKeyDown} rows="2" placeholder={`Message ${selected.ticketNumber}`} /><div className="teams-compose-actions"><div className="teams-emoji-anchor"><button title="Emoji" onClick={() => setEmojiOpen((value) => !value)}><Smile /></button>{emojiOpen && <div className="teams-emoji-picker">{EMOJIS.map((emoji) => <button key={emoji} onClick={() => { setReply((value) => `${value}${emoji}`); setEmojiOpen(false) }}>{emoji}</button>)}</div>}<label title="Attach files"><input type="file" multiple onChange={(event) => upload(event, 'reply')} /><Paperclip /></label></div><button className="teams-send" disabled={saving || uploading || (!reply.trim() && !replyFiles.length)} onClick={sendReply}>{saving ? <Loader2 className="animate-spin" /> : <Send />}</button></div></div><small>Press Enter to send · Shift + Enter for a new line</small></footer></>}
        </>}</main>
      </section>
    </div>
    {creating && <div className="teams-modal-backdrop"><form onSubmit={create} className="teams-create-modal"><header><div><small>Internal collaboration</small><h2>New ticket chat</h2><p>Create a private workspace with selected participants.</p></div><button type="button" onClick={() => setCreating(false)}><X /></button></header><div className="teams-create-body"><label><span>Subject</span><input required value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} placeholder="What does your team need to discuss?" /></label><label><span>Priority</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select></label><fieldset><legend>Select participants</legend><div>{users.map((user) => { const id = String(user._id || user.id); return <label key={id}><input type="checkbox" checked={draft.participants.includes(id)} onChange={(event) => setDraft((current) => ({ ...current, participants: event.target.checked ? [...current.participants, id] : current.participants.filter((value) => value !== id) }))} /><span className="teams-avatar">{initials(user.name || user.email)}</span><span>{user.name || user.email}</span></label> })}</div></fieldset><label><span>First message</span><textarea value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} rows="4" placeholder="Start the conversation..." /></label><label className="teams-upload"><input type="file" multiple onChange={(event) => upload(event, 'draft')} /><Paperclip />Attach files or images</label><AttachmentList items={draft.attachments} /></div><footer><button type="button" onClick={() => setCreating(false)}>Cancel</button><button disabled={saving || uploading}>{saving ? 'Creating...' : 'Create ticket chat'}</button></footer></form></div>}
    {previewFile && <div className="teams-modal-backdrop"><div className="teams-preview-modal"><header><div><h2>{previewFile.name || 'Attachment preview'}</h2><small>{previewFile.type || 'Shared file'}</small></div><button onClick={() => setPreviewFile(null)}><X /></button></header><div>{String(previewFile.type || '').startsWith('image/') ? <img src={fileUrl(previewFile)} alt={previewFile.name || 'Attachment'} /> : String(previewFile.type || '').includes('pdf') ? <iframe src={fileUrl(previewFile)} title={previewFile.name || 'PDF preview'} /> : <div className="teams-preview-unsupported"><FileText /><p>Preview is not available for this file type.</p><a href={fileUrl(previewFile)} target="_blank" rel="noreferrer">Open file</a></div>}</div><footer><button type="button" onClick={() => downloadInternalTicketFile(previewFile).catch(() => setError('Unable to download this attachment.'))}><Download />Download</button></footer></div></div>}
    {callMode && <div className="teams-modal-backdrop"><div className="teams-call-modal"><header><strong>{callMode.includes('video') ? 'Video call' : 'Audio call'} · {selected?.subject}</strong><button onClick={() => callMode.startsWith('incoming') ? rejectCall() : endCall()}><X /></button></header><div className="teams-call-stage">{callMode.includes('video') && !callMode.startsWith('incoming') ? <div className="teams-video-stage"><video ref={remoteVideoRef} autoPlay playsInline /><video className="teams-local-video" ref={localVideoRef} autoPlay muted playsInline /></div> : <span className="teams-avatar teams-call-avatar">{initials(callMode.startsWith('incoming') ? selected?.callSession?.initiatedByName : selected?.subject)}</span>}<h2>{callError || (callMode.startsWith('incoming') ? `${selected?.callSession?.initiatedByName || 'A participant'} is calling` : callStatus)}</h2><p>{callError ? 'Check browser permissions and try again.' : callMode.startsWith('incoming') ? `Incoming ${selected?.callSession?.mode || 'audio'} call for ${selected?.ticketNumber}` : callStatus === 'Connected' ? 'You are now connected to the other participant.' : 'Waiting for another ticket participant to answer.'}</p></div><footer>{callMode.startsWith('incoming') ? <><button className="teams-call-accept" onClick={answerCall}><Phone /></button><button className="teams-call-end" onClick={rejectCall}><Phone /></button></> : <><button className="teams-call-control"><Mic /></button><button className="teams-call-control"><Video /></button><button className="teams-call-end" onClick={() => endCall()}><Phone /></button></>}</footer></div></div>}
    {callMode && !callMode.includes('video') && !callMode.startsWith('incoming') && <audio ref={remoteVideoRef} autoPlay />}
  </DashboardShell>
}
