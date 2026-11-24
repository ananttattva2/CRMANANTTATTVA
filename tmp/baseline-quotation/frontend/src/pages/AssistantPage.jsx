import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, BookOpen, Bot, CheckCircle2, ChevronRight, LayoutDashboard, Menu, MessageSquarePlus, Search, Send, Sparkles, Trash2, UserRound, WandSparkles, X } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'
import { buildAnswer } from '../components/dashboard/SidebarChatbot'
import api from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { mergeClientSources } from '../features/clientMaster/clientMaster.utils'
import { useNavigate } from 'react-router-dom'
import { piboOperationsFaq } from '../components/dashboard/piboOperationsFaq'

const starters = [
  { label: 'My name', prompt: 'What is my name?' },
  { label: 'Client Master', prompt: 'Explain Client Master full flow' },
  { label: 'PIBO Operations', prompt: 'How is the PIBO Operations module accessed?' },
  { label: 'Bulk Upload', prompt: 'How do I complete a procurement bulk upload?' },
  { label: 'See all', action: 'question-index' }
]

const crmQuestionIndex = [
  ['CRM Workflows', 'How does the Dashboard work?'],
  ['CRM Workflows', 'Explain Lead Generation full flow'],
  ['CRM Workflows', 'Explain Client Master full flow'],
  ['CRM Workflows', 'How do I use Add Quotation?'],
  ['CRM Workflows', 'How does Pending Approval work?'],
  ['CRM Workflows', 'How do Notifications work?'],
  ['CRM Workflows', 'How do Calendar follow-ups and to-dos work?'],
  ['Client Master', 'Explain Client Basic Info'],
  ['Client Master', 'Explain Address Details in Client Master'],
  ['Client Master', 'Explain CTE & CTO / CCA details'],
  ['Client Master', 'Explain CPCB Login Credential'],
  ['Client Master', 'Explain CPCB Screenshot uploads'],
  ['Client Master', 'Explain Authorized Person Details'],
  ['Annual Return', 'Explain Annual Return History'],
  ['Annual Return', 'Explain Annual Return Data Part A Part B Part C Part D']
].map(([section, question]) => ({ section, title: question, question }))

const allQuestionIndex = [
  ...crmQuestionIndex,
  ...piboOperationsFaq.map((entry) => ({ section: entry.section, title: entry.title, question: entry.questions[0] }))
]

function readUser() {
  try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} }
}

function welcomeMessage(name) {
  const firstName = String(name || 'there').trim().split(/\s+/)[0]
  return { id: 'welcome', role: 'assistant', text: `Hello ${firstName}! I’m your Anant Tattva CRM Assistant. Ask naturally—even short phrases or small spelling mistakes are okay.`, suggestions: starters }
}

function AnimatedAnswer({ message, onNavigate, onOpenIndex }) {
  const [visible, setVisible] = useState(message.animate ? '' : message.text)
  const [complete, setComplete] = useState(!message.animate)

  useEffect(() => {
    if (!message.animate) return undefined
    let index = 0
    const step = Math.max(2, Math.ceil(message.text.length / 180))
    const timer = window.setInterval(() => {
      index = Math.min(message.text.length, index + step)
      setVisible(message.text.slice(0, index))
      if (index >= message.text.length) { window.clearInterval(timer); setComplete(true) }
    }, 16)
    return () => window.clearInterval(timer)
  }, [message.id, message.text, message.animate])

  const report = message.report
  return <><p className="whitespace-pre-line text-[15px] font-semibold leading-7">{visible}{!complete && <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-emerald-500 align-middle" />}</p>{complete && report && <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-4 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white"><div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">{[['Assigned to', report.owner], ['Filled', `${report.filledFields}/${report.totalFields}`], ['Remaining', report.remainingFields], ['Alerts', report.alertCount]].map(([label, value]) => <div key={label} className="rounded-xl border border-white bg-white/90 p-3 shadow-sm"><small className="block text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</small><strong className="mt-1 block truncate text-sm text-slate-800">{value}</strong></div>)}</div><div className="space-y-2 border-t border-emerald-100 p-3">{report.rows.map((row, index) => <motion.div key={row.section} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .05 }}><div className="mb-1 flex justify-between text-xs font-bold text-slate-600"><span>{row.section}</span><span>{row.filled}/{row.filled + row.missingCount} · {row.percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><motion.i initial={{ width: 0 }} animate={{ width: `${row.percent}%` }} transition={{ duration: .45, delay: index * .05 }} className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-600" /></div></motion.div>)}</div>{report.criticalMissing?.length > 0 && <div className="border-t border-amber-100 bg-amber-50 p-3 text-xs font-bold text-amber-800"><AlertTriangle className="mr-1 inline h-4 w-4" /> Missing: {report.criticalMissing.slice(0, 4).join(', ')}</div>}<div className="flex flex-wrap gap-2 border-t border-emerald-100 p-3"><button onClick={() => onNavigate('/sales/client-master')} className="inline-flex items-center gap-2 rounded-xl bg-[#0f6655] px-3 py-2 text-xs font-black text-white"><CheckCircle2 className="h-4 w-4" /> Open Client Master</button><button onClick={() => onNavigate('/dashboard')} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-700"><LayoutDashboard className="h-4 w-4" /> Open Dashboard</button></div></motion.div>}{complete && message.source && <motion.small initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 block font-bold text-emerald-600">{message.source}</motion.small>}{complete && message.suggestions?.length > 0 && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex flex-wrap gap-2">{message.suggestions.map((suggestion) => <button key={suggestion.prompt || suggestion.label} onClick={() => suggestion.action === 'question-index' ? onOpenIndex() : message.onSuggestion(suggestion.prompt)} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 transition hover:-translate-y-0.5 hover:bg-emerald-100">{suggestion.action === 'question-index' && <BookOpen className="h-3.5 w-3.5" />}{suggestion.label}<ChevronRight className="h-3 w-3" /></button>)}</motion.div>}</>
}

export default function AssistantPage() {
  const navigate = useNavigate()
  const storedUser = useMemo(readUser, [])
  const [user, setUser] = useState(storedUser)
  const userName = user.name || user.fullName || 'Krishna Yadav'
  const [threads, setThreads] = useState(() => [{ id: Date.now(), title: 'New conversation', messages: [welcomeMessage(userName)] }])
  const [activeId, setActiveId] = useState(() => threads[0].id)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [clients, setClients] = useState([])
  const [railOpen, setRailOpen] = useState(false)
  const [questionIndexOpen, setQuestionIndexOpen] = useState(false)
  const [questionSearch, setQuestionSearch] = useState('')
  const endRef = useRef(null)
  const active = threads.find((thread) => thread.id === activeId) || threads[0]
  const indexedQuestions = useMemo(() => {
    const query = questionSearch.trim().toLowerCase()
    return allQuestionIndex.filter((item) => !query || `${item.section} ${item.title} ${item.question}`.toLowerCase().includes(query))
  }, [questionSearch])
  const indexedSections = useMemo(() => [...new Set(indexedQuestions.map((item) => item.section))], [indexedQuestions])

  useEffect(() => {
    api.get(API_ENDPOINTS.auth.me).then((response) => {
      const freshUser = response.data?.user || storedUser
      setUser(freshUser)
      localStorage.setItem('user', JSON.stringify(freshUser))
    }).catch(() => {})
  }, [storedUser])

  useEffect(() => {
    api.get(API_ENDPOINTS.clients.list).then((response) => {
      const rows = response.data?.clients || []
      setClients(mergeClientSources(rows, []))
    }).catch(() => setClients([]))
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active?.messages, typing])

  function newChat() {
    const thread = { id: Date.now(), title: 'New conversation', messages: [welcomeMessage(userName)] }
    setThreads((items) => [thread, ...items])
    setActiveId(thread.id)
    setRailOpen(false)
  }

  function send(text = input) {
    const question = String(text || '').trim()
    if (!question || typing) return
    setQuestionIndexOpen(false)
    const answer = buildAnswer(question, { userName, clients })
    setInput('')
    setTyping(true)
    setThreads((items) => items.map((thread) => thread.id === activeId ? {
      ...thread,
      title: thread.title === 'New conversation' ? question.slice(0, 42) : thread.title,
      messages: [...thread.messages, { id: `u-${Date.now()}`, role: 'user', text: question }]
    } : thread))
    window.setTimeout(() => {
      setThreads((items) => items.map((thread) => thread.id === activeId ? {
        ...thread,
        messages: [...thread.messages, { id: `a-${Date.now()}`, role: 'assistant', ...answer, animate: true }]
      } : thread))
      setTyping(false)
    }, 380)
  }

  function deleteThread(id) {
    const remaining = threads.filter((thread) => thread.id !== id)
    if (!remaining.length) { newChat(); return }
    setThreads(remaining)
    if (activeId === id) setActiveId(remaining[0].id)
  }

  return (
    <DashboardShell currentUser={user}>
      <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(circle_at_50%_0%,rgba(16,185,129,.12),transparent_38%),linear-gradient(135deg,#f4fbf9,#fffaf5)] p-3 sm:p-5">
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex h-[calc(100vh-6.5rem)] max-w-[1500px] overflow-hidden rounded-[28px] border border-emerald-100 bg-white/90 shadow-[0_28px_80px_rgba(15,93,70,.15)] backdrop-blur-xl">
          <AnimatePresence>
            {(railOpen || true) && <motion.aside initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className={`${railOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-30 w-[290px] flex-col border-r border-emerald-100 bg-[#073f35] p-4 text-white lg:static lg:flex`}>
              <div className="flex items-center gap-3 px-2 py-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-300 to-teal-500 text-[#073f35]"><Bot /></span><div><strong className="block text-lg">CRM Assistant</strong><small className="text-emerald-200">Anant Tattva intelligence</small></div></div>
              <button onClick={newChat} className="mt-4 flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#f45b0b] font-black shadow-lg shadow-orange-950/20 transition hover:-translate-y-0.5 hover:bg-orange-500"><MessageSquarePlus className="h-5 w-5" /> New chat</button>
              <p className="mb-2 mt-7 px-2 text-[11px] font-black uppercase tracking-[.2em] text-emerald-300">Recent conversations</p>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">{threads.map((thread) => <button key={thread.id} onClick={() => { setActiveId(thread.id); setRailOpen(false) }} className={`group flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-bold transition ${activeId === thread.id ? 'bg-white/14 text-white' : 'text-emerald-100 hover:bg-white/8'}`}><span className="min-w-0 flex-1 truncate">{thread.title}</span><Trash2 onClick={(event) => { event.stopPropagation(); deleteThread(thread.id) }} className="h-4 w-4 opacity-0 transition group-hover:opacity-70" /></button>)}</div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/8 p-3"><div className="flex items-center gap-3">{user.avatarUrl ? <img src={user.avatarUrl} alt={userName} className="h-11 w-11 shrink-0 rounded-full border-2 border-emerald-300 object-cover shadow-lg" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-400/20 text-emerald-200"><UserRound className="h-5 w-5" /></span>}<div className="min-w-0"><strong className="block truncate text-sm">{userName}</strong><small className="text-emerald-200">{user.role || 'CRM User'}</small></div></div></div>
            </motion.aside>}
          </AnimatePresence>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-16 items-center justify-between border-b border-slate-100 px-4 sm:px-7"><div className="flex items-center gap-3"><button onClick={() => setRailOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 lg:hidden"><Menu /></button><div><strong className="block text-slate-900">Intelligent CRM workspace</strong><small className="text-slate-500">Context-aware answers and guided next steps</small></div></div><span className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 sm:flex"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Ready</span></header>

            <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-7 sm:px-8 lg:px-16">
              <AnimatePresence>{questionIndexOpen && <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="absolute inset-0 z-20 overflow-y-auto bg-gradient-to-br from-[#f5fbf9] to-[#fffaf5] p-4 sm:p-7"><div className="mx-auto max-w-5xl"><header className="sticky top-0 z-10 rounded-3xl border border-emerald-100 bg-white/95 p-5 shadow-lg backdrop-blur"><div className="flex items-start justify-between gap-3"><div><span className="text-xs font-black uppercase tracking-[.18em] text-emerald-600">Knowledge index</span><h2 className="mt-1 text-2xl font-black text-slate-950">All questions</h2><p className="mt-1 text-sm font-semibold text-slate-500">{indexedQuestions.length} questions · click any question to get its answer</p></div><button onClick={() => setQuestionIndexOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600"><X /></button></div><label className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4"><Search className="h-5 w-5 text-emerald-600" /><input autoFocus value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="Search questions, modules or topics..." className="h-12 flex-1 bg-transparent font-semibold text-slate-800 outline-none" /></label></header><div className="mt-5 space-y-5">{indexedSections.map((section) => <motion.article key={section} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><h3 className="border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white px-5 py-4 text-sm font-black uppercase tracking-wider text-emerald-800">{section}</h3><div className="grid gap-2 p-3 md:grid-cols-2">{indexedQuestions.filter((item) => item.section === section).map((item, index) => <button key={`${section}-${item.title}-${index}`} onClick={() => send(item.question)} className="group flex items-center justify-between gap-3 rounded-2xl border border-transparent bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-700 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"><span>{item.title}</span><ChevronRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-1" /></button>)}</div></motion.article>)}{!indexedQuestions.length && <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center font-bold text-slate-500">No matching questions found.</div>}</div></div></motion.section>}</AnimatePresence>
              <div className="mx-auto max-w-4xl space-y-7">
                {active.messages.map((message) => <motion.div key={message.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'assistant' && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-lg shadow-emerald-700/20"><Sparkles className="h-5 w-5" /></span>}
                  <div className={`max-w-[92%] ${message.role === 'user' ? 'rounded-[22px_22px_6px_22px] bg-[#0f6655] text-white' : 'rounded-[22px_22px_22px_6px] border border-slate-200 bg-white text-slate-700 shadow-sm'} px-5 py-4`}>{message.role === 'assistant' ? <AnimatedAnswer message={{ ...message, onSuggestion: send }} onNavigate={navigate} onOpenIndex={() => setQuestionIndexOpen(true)} /> : <p className="whitespace-pre-line text-[15px] font-semibold leading-7">{message.text}</p>}</div>
                </motion.div>)}
                {typing && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-600 text-white"><Bot className="h-5 w-5" /></span><span className="flex gap-1 rounded-2xl border bg-white px-5 py-4">{[0,1,2].map((i) => <i key={i} style={{ animationDelay: `${i * 120}ms` }} className="h-2 w-2 animate-bounce rounded-full bg-emerald-500" />)}</span></motion.div>}
                <div ref={endRef} />
              </div>
            </div>

            <div className="border-t border-slate-100 bg-white/85 p-4 sm:px-8 sm:py-5"><form onSubmit={(event) => { event.preventDefault(); send() }} className="mx-auto flex max-w-4xl items-end gap-3 rounded-[24px] border border-emerald-200 bg-white p-2 shadow-[0_14px_38px_rgba(15,93,70,.13)] transition focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-100"><span className="mb-1 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-orange-50 text-[#f45b0b]"><WandSparkles className="h-5 w-5" /></span><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }} rows={1} placeholder="Ask anything about CRM, your profile or PIBO operations…" className="max-h-32 min-h-11 flex-1 resize-none border-0 bg-transparent px-1 py-3 font-semibold text-slate-800 outline-none placeholder:text-slate-400" /><button disabled={!input.trim() || typing} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#0f6655] text-white shadow-lg transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-5 w-5" /></button></form><p className="mt-2 text-center text-[11px] font-semibold text-slate-400">CRM Assistant may need source records to answer live-data questions. Verify critical compliance decisions.</p></div>
          </div>
        </motion.section>
      </div>
    </DashboardShell>
  )
}
