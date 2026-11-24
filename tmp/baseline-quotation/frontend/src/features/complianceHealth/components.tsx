import React from 'react'
import {
  BarChart3, Bell, BookOpenCheck, ChevronDown, CircleHelp, ClipboardCheck, FileText,
  FolderOpen, Gauge, LayoutDashboard, Menu, Search, Settings, ShieldCheck, Users, X,
} from 'lucide-react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { IssueStatus, Owner, Severity } from './types'

export const severityStyles: Record<Severity, string> = {
  Critical: 'bg-red-50 text-red-700 ring-red-200',
  High: 'bg-orange-50 text-orange-700 ring-orange-200',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  Low: 'bg-green-50 text-green-700 ring-green-200',
}

const statusStyles: Record<IssueStatus, string> = {
  Open: 'bg-red-50 text-red-700 ring-red-200',
  'In progress': 'bg-blue-50 text-blue-700 ring-blue-200',
  'Awaiting evidence': 'bg-amber-50 text-amber-700 ring-amber-200',
  Resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
}

export function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ring-1 ring-inset ${className}`}>{children}</span>
}

export function SeverityBadge({ value }: { value: Severity }) {
  return <Badge className={severityStyles[value]}>{value}</Badge>
}

export function StatusBadge({ value }: { value: IssueStatus }) {
  return <Badge className={statusStyles[value]}>{value}</Badge>
}

export function OwnerCell({ owner }: { owner: Owner }) {
  return <div className="flex items-center gap-2"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-black ${owner.color}`}>{owner.initials}</span><span className="whitespace-nowrap text-xs font-bold text-slate-700">{owner.name}</span></div>
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,.045)] ${className}`}>{children}</section>
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="text-[15px] font-black text-slate-900">{title}</h2>{subtitle && <p className="mt-1 text-xs font-semibold text-slate-500">{subtitle}</p>}</div>{action}</div>
}

const navigation = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Customers', icon: Users, to: '/sales/client-master' },
  { label: 'Compliance', icon: ShieldCheck, to: '/compliance/health-report' },
  { label: 'Risk Monitoring', icon: Gauge, to: '/compliance/health-report?view=risks' },
  { label: 'Reports', icon: BarChart3, to: '/compliance/health-report?view=reports' },
  { label: 'Tasks', icon: ClipboardCheck, to: '/calendar' },
  { label: 'Documents', icon: FolderOpen, to: '/sales/client-master' },
  { label: 'Settings', icon: Settings, to: '/dashboard' },
]

export function ComplianceShell({ collapsed, onCollapse, mobileOpen, onMobileClose, children }: {
  collapsed: boolean; onCollapse: () => void; mobileOpen: boolean; onMobileClose: () => void; children: React.ReactNode
}) {
  const navigate = useNavigate()
  const currentLocation = useLocation()
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [globalSearch, setGlobalSearch] = React.useState('')
  const [helpOpen, setHelpOpen] = React.useState(false)
  const user = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} }
  }, [])
  return <div className="min-h-screen bg-[#F6F8FB] text-slate-900">
    {mobileOpen && <button aria-label="Close navigation overlay" className="fixed inset-0 z-40 bg-slate-950/35 lg:hidden" onClick={onMobileClose} />}
    <aside className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-slate-200 bg-[#0B1528] text-white transition-all duration-200 ${collapsed ? 'w-[76px]' : 'w-[244px]'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
      <div className="flex h-[72px] items-center gap-3 border-b border-white/10 px-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500 font-black">AT</div>
        {!collapsed && <div className="min-w-0"><p className="truncate text-sm font-black">Anant Tattva</p><p className="truncate text-[10px] font-bold text-slate-400">Compliance Workspace</p></div>}
        <button className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden" onClick={onMobileClose} aria-label="Close sidebar"><X size={18} /></button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
        {navigation.map(({ label, icon: Icon, to }) => <NavLink key={label} to={to} onClick={onMobileClose} title={collapsed ? label : undefined} className={({ isActive }) => `flex h-11 items-center gap-3 rounded-xl px-3 text-xs font-extrabold transition ${isActive || label === 'Compliance' && currentLocation.pathname === '/compliance/health-report' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-950/30' : 'text-slate-300 hover:bg-white/8 hover:text-white'}`}><Icon size={18} />{!collapsed && <span>{label}</span>}</NavLink>)}
      </nav>
      <button onClick={onCollapse} className="m-3 hidden h-10 items-center justify-center gap-2 rounded-xl border border-white/10 text-xs font-bold text-slate-300 hover:bg-white/10 lg:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Menu size={17} />{!collapsed && 'Collapse'}</button>
    </aside>
    <div className={`transition-all duration-200 ${collapsed ? 'lg:ml-[76px]' : 'lg:ml-[244px]'}`}>
      <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6">
        <button className="rounded-xl border border-slate-200 p-2.5 text-slate-600 lg:hidden" onClick={onMobileClose} aria-label="Open navigation"><Menu size={19} /></button>
        <form className="relative hidden w-full max-w-md sm:block" onSubmit={(event) => { event.preventDefault(); if (globalSearch.trim()) navigate(`/compliance/health-report?q=${encodeURIComponent(globalSearch.trim())}`) }}><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" placeholder="Search customers, controls, issues…" aria-label="Global search" /></form>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="relative rounded-xl p-2.5 text-slate-500 hover:bg-slate-100" aria-label="Notifications" onClick={() => navigate('/notifications')}><Bell size={19} /><span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" /></button>
          <div className="relative"><button className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100" aria-label="Help" onClick={() => setHelpOpen((value) => !value)}><CircleHelp size={19} /></button>{helpOpen && <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"><strong className="text-xs">Compliance help</strong><p className="mt-1 text-[11px] font-semibold leading-5 text-slate-500">Select an issue to view remediation guidance, evidence, and its activity history.</p><button onClick={() => setHelpOpen(false)} className="mt-2 text-[10px] font-black text-emerald-700">Got it</button></div>}</div>
          <div className="relative ml-1">
            <button className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-slate-100" onClick={() => setProfileOpen((value) => !value)} aria-expanded={profileOpen}><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-[11px] font-black text-white">{String(user?.name || 'CRM').split(' ').map((part: string) => part[0]).join('').slice(0, 2)}</span><span className="hidden text-left md:block"><strong className="block max-w-28 truncate text-xs">{user?.name || 'CRM User'}</strong><span className="block text-[10px] text-slate-500">{user?.role || 'Compliance Admin'}</span></span><ChevronDown size={14} className="hidden md:block" /></button>
            {profileOpen && <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"><button onClick={() => navigate('/dashboard')} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-slate-50">View profile</button><button onClick={() => { localStorage.removeItem('token'); navigate('/') }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-red-600 hover:bg-red-50">Sign out</button></div>}
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  </div>
}

export function SkeletonDashboard() {
  return <div className="animate-pulse space-y-5 p-5 md:p-7"><div className="h-28 rounded-2xl bg-slate-200" /><div className="grid gap-4 md:grid-cols-5">{[1,2,3,4,5].map((item) => <div key={item} className="h-28 rounded-2xl bg-slate-200" />)}</div><div className="grid gap-5 lg:grid-cols-3"><div className="h-80 rounded-2xl bg-slate-200 lg:col-span-2" /><div className="h-80 rounded-2xl bg-slate-200" /></div></div>
}

export function EmptyState({ title, detail, onReset }: { title: string; detail: string; onReset?: () => void }) {
  return <div className="grid min-h-52 place-items-center p-8 text-center"><div><BookOpenCheck className="mx-auto text-slate-300" size={32} /><h3 className="mt-3 text-sm font-black">{title}</h3><p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p>{onReset && <button onClick={onReset} className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black hover:bg-slate-50">Clear filters</button>}</div></div>
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return <div className="m-5 rounded-2xl border border-red-200 bg-red-50 p-8 text-center"><FileText className="mx-auto text-red-500" /><h2 className="mt-3 font-black text-red-900">Unable to load compliance data</h2><p className="mt-1 text-sm text-red-700">The reporting service did not respond. Your existing data is safe.</p><button onClick={onRetry} className="mt-4 rounded-xl bg-red-700 px-4 py-2 text-xs font-black text-white hover:bg-red-800">Try again</button></div>
}
