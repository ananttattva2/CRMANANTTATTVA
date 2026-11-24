import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Crown, Search, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import ToastMessage from '../ToastMessage'

export default function CreateTeamModal({ users, saving, error, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    members: [],
    manager: '',
    operationHead: ''
  })
  const [memberSearch, setMemberSearch] = useState('')

  const activeUsers = useMemo(() => users.filter((user) => user.isActive), [users])
  const managerOptions = activeUsers.filter((user) => user.role === 'manager')
  const headOptions = activeUsers
  const selectedManagerId = String(form.manager || '')
  const memberOptions = useMemo(() => {
    if (!selectedManagerId) return []
    return activeUsers.filter((user) => {
      const id = String(user._id || user.id || '')
      if (id === selectedManagerId) return false
      if (id === String(form.operationHead || '')) return false
      return !['manager', 'admin', 'superadmin'].includes(String(user.role || '').toLowerCase())
    })
  }, [activeUsers, form.operationHead, selectedManagerId])
  const visibleMemberOptions = useMemo(() => {
    const query = memberSearch.trim().toLowerCase()
    if (!query) return memberOptions
    return memberOptions.filter((user) => `${user.name || ''} ${user.email || ''} ${user.role || ''}`.toLowerCase().includes(query))
  }, [memberOptions, memberSearch])

  function toggleMember(id) {
    setForm((value) => ({
      ...value,
      members: value.members.includes(id)
        ? value.members.filter((memberId) => memberId !== id)
        : [...value.members, id]
    }))
  }

  function submit(event) {
    event.preventDefault()
    onSubmit(form)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4 py-6">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Team Control</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">Create New Team</h2>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50" aria-label="Close modal" title="Close">
            <X className="h-6 w-6" />
          </button>
        </div>

        {error && <ToastMessage type="error" className="mt-5">{error}</ToastMessage>}

        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          <Field label="Team Name">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required className="form-input" placeholder="Enter team name" />
          </Field>
          <Field label="Select Manager">
            <PeopleSelect value={form.manager} options={managerOptions} placeholder="Choose manager" onChange={(manager) => { setForm({ ...form, manager, members: [] }); setMemberSearch('') }} />
          </Field>
          <Field label="Select Operation Head (Optional)">
            <PeopleSelect value={form.operationHead} options={headOptions} placeholder="No operation head" onChange={(operationHead) => setForm((value) => ({ ...value, operationHead, members: value.members.filter((id) => String(id) !== String(operationHead)) }))} allowEmpty />
          </Field>
          <Field label="Description">
            <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="form-input" placeholder="Optional" />
          </Field>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-slate-950">Select Users</p>
              <p className="mt-1 text-xs font-bold text-slate-500">{form.manager ? 'Select multiple users to map under this manager.' : 'Choose a manager to view eligible users.'}</p>
            </div>
            <span className="rounded-lg bg-white px-3 py-2 text-sm font-black text-emerald-700 ring-1 ring-emerald-100">{form.members.length} selected</span>
          </div>

          {form.manager && memberOptions.length > 0 && <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-emerald-400 focus-within:ring-4 focus-within:ring-emerald-100">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" placeholder="Search users by name, email, or role..." />
              {memberSearch && <button type="button" onClick={() => setMemberSearch('')} aria-label="Clear search"><X className="h-4 w-4 text-slate-400" /></button>}
            </label>
            <button type="button" onClick={() => setForm((value) => ({ ...value, members: memberOptions.every((user) => value.members.includes(user._id || user.id)) ? [] : memberOptions.map((user) => user._id || user.id) }))} className="min-h-11 rounded-xl border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-700 hover:bg-emerald-50">
              {memberOptions.every((user) => form.members.includes(user._id || user.id)) ? 'Clear all' : 'Select all'}
            </button>
          </div>}

          <div className="mt-4 grid max-h-72 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {visibleMemberOptions.length ? visibleMemberOptions.map((user) => {
              const id = user._id || user.id
              const checked = form.members.includes(id)
              return (
                <label key={id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-200'}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleMember(id)} className="h-4 w-4 accent-emerald-700" />
                  <Avatar user={user} />
                  <span className="min-w-0">
                    <span className="block truncate font-black text-slate-950">{user.name || user.email}</span>
                    <span className="block truncate text-xs font-bold text-slate-500">{user.email}</span>
                  </span>
                </label>
              )
            }) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm font-black text-slate-500 sm:col-span-2">
                {form.manager ? (memberOptions.length ? 'No users match your search.' : 'No eligible active users are available.') : 'Select manager first.'}
              </div>
            )}
          </div>
        </section>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Summary icon={Users} label="Members" value={form.members.length || '-'} />
          <Summary icon={Crown} label="Manager" value={nameFor(activeUsers, form.manager)} />
          <Summary icon={ShieldCheck} label="Operation Head" value={nameFor(activeUsers, form.operationHead)} />
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-11 rounded-lg border border-slate-200 px-7 font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="min-h-11 rounded-lg bg-slate-950 px-8 font-black text-white shadow-lg shadow-slate-950/20 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70">
            {saving ? 'Creating...' : 'Create Team'}
          </button>
        </div>
      </form>
    </div>
  )
}

function PeopleSelect({ value, options, placeholder, onChange, allowEmpty = false }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const selected = options.find((user) => String(user._id || user.id) === String(value))
  const filtered = options.filter((user) => `${user.name || ''} ${user.email || ''} ${user.role || ''}`.toLowerCase().includes(search.trim().toLowerCase()))

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.max(rect.width, 320)
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.bottom + 7, width })
  }

  useEffect(() => {
    if (!open) return undefined
    positionMenu()
    function closeOutside(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open])

  function choose(id) {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <>
      <button ref={triggerRef} type="button" className={`team-people-trigger ${open ? 'is-open' : ''}`} onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="team-people-trigger-avatar">{selected ? <Avatar user={selected} /> : <UserRound className="h-4 w-4" />}</span>
        <span className="team-people-trigger-copy"><strong>{selected?.name || selected?.email || placeholder}</strong>{selected && <small>{selected.email || selected.role}</small>}</span>
        <ChevronDown className="team-people-chevron h-4 w-4" />
      </button>
      {open && position && createPortal(
        <div ref={menuRef} className="team-people-menu" style={position}>
          <div className="team-people-search"><Search className="h-4 w-4" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email..." />{search && <button type="button" onClick={() => setSearch('')}><X className="h-4 w-4" /></button>}</div>
          <div className="team-people-options" role="listbox">
            {allowEmpty && !search && <button type="button" role="option" aria-selected={!value} onClick={() => choose('')}><span className="team-people-option-avatar"><UserRound className="h-4 w-4" /></span><span><strong>{placeholder}</strong><small>Leave this position unassigned</small></span>{!value && <Check className="h-4 w-4" />}</button>}
            {filtered.map((user) => { const id = user._id || user.id; return <button key={id} type="button" role="option" aria-selected={String(id) === String(value)} onClick={() => choose(id)}><Avatar user={user} /><span><strong>{user.name || user.email}</strong><small>{user.email || user.role}</small></span>{String(id) === String(value) && <Check className="h-4 w-4" />}</button> })}
            {!filtered.length && <div className="team-people-empty">No matching user found</div>}
          </div>
          <div className="team-people-foot">{filtered.length} active user{filtered.length === 1 ? '' : 's'}</div>
        </div>, document.body
      )}
    </>
  )
}

function Avatar({ user }) {
  const label = (user.name || user.email || 'U').slice(0, 1).toUpperCase()
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-emerald-700 to-sky-700 text-sm font-black text-white">
      {user.avatarUrl ? <img src={user.avatarUrl} alt={user.name || user.email} className="h-full w-full object-cover" /> : label}
    </span>
  )
}

function Summary({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <Icon className="h-5 w-5 text-emerald-700" />
      <p className="mt-3 text-xs font-black uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="mt-1 truncate font-black text-slate-950">{value || '-'}</p>
    </div>
  )
}

function nameFor(users, id) {
  const user = users.find((item) => String(item._id || item.id) === String(id))
  return user?.name || user?.email || '-'
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-700">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  )
}
