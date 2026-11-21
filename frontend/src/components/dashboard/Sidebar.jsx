import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, BriefcaseBusiness, ChevronDown, ChevronsLeft, ClipboardList, FileText, Gauge, LifeBuoy, MessagesSquare, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import { adminRoles, hasAnyRole, navSections } from '../../constants/dashboard'
import api from '../../services/api'
import './Sidebar.css'

const sectionIcons = [BarChart3, ClipboardList, UserRound, FileText, ShieldCheck, ClipboardList, MessagesSquare, Users, LifeBuoy]
const sectionId = label => `nav-section-${label.replace(/[^a-z0-9]/gi, '-')}`
const PENDING_STATUS_LABELS = {
  annualActionRequired: 'AR Action Required',
  applied: 'Applied',
  underReview: 'Under Review',
  notStarted: 'Not Started',
  rejected: 'Rejected'
}

export default function Sidebar({ currentUser, collapsed, onToggleCollapsed, onClose, dashboardMode = 'operations', onDashboardModeChange }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [openSection, setOpenSection] = useState(null)
  const [openGroups, setOpenGroups] = useState({})
  const [flyout, setFlyout] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingBreakdown, setPendingBreakdown] = useState({})
  const sidebarRef = useRef(null)
  const flyoutRef = useRef(null)
  const triggerRef = useRef(null)
  const currentPath = `${location.pathname}${location.search}`
  const canChooseDashboard = hasAnyRole(currentUser, adminRoles)

  useEffect(() => {
    let cancelled = false
    api.get('/dashboard-insights/pending-count').then(({ data }) => {
      if (!cancelled && data?.ok) {
        setPendingCount(Number(data.count) || 0)
        setPendingBreakdown(data.breakdown || {})
      }
    }).catch(() => { if (!cancelled) { setPendingCount(0); setPendingBreakdown({}) } })
    return () => { cancelled = true }
  }, [currentUser?._id])

  useEffect(() => { setFlyout(null) }, [currentPath, collapsed])
  useEffect(() => {
    if (!flyout) return undefined
    flyoutRef.current?.querySelector('div.space-y-1 button')?.focus()
    function dismiss(event) {
      if (!sidebarRef.current?.contains(event.target) && !flyoutRef.current?.contains(event.target)) setFlyout(null)
    }
    function keydown(event) {
      if (event.key === 'Escape') { setFlyout(null); triggerRef.current?.focus() }
    }
    function close() { setFlyout(null) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', close)
    }
  }, [flyout])

  function pathMatches(path) {
    if (!path) return false
    if (path === '/summary-dashboard') return location.pathname.startsWith('/summary-dashboard')
    return path.includes('?') ? path === currentPath : path === location.pathname && !location.search
  }
  function canShowItem(item) {
    if (Array.isArray(item.roles) && !hasAnyRole(currentUser, item.roles)) return false
    if (item.label === 'User Management' && !canChooseDashboard) return false
    if (item.label === 'Dashboard') return true
    return !item.children?.length || item.children.some(canShowItem)
  }
  function containsRoute(item) { return (item.label === 'Dashboard' && pathMatches('/overall-dashboard')) || pathMatches(item.path) || item.children?.some(containsRoute) }
  function visit(item) {
    if (item.dashboardMode) onDashboardModeChange?.(item.dashboardMode)
    navigate(item.path)
    setFlyout(null)
    onClose?.()
  }
  function sectionItems(section) {
    return section.items.filter(canShowItem).flatMap(item => item.label === 'Dashboard' ? [
      { label: 'Application Dashboard', icon: BarChart3, path: '/overall-dashboard' },
      ...(!canChooseDashboard ? [{ label: 'My Dashboard', icon: Gauge, path: '/dashboard' }] : []),
      ...item.children.filter(canShowItem)
    ] : [item])
  }
  function renderItems(items, light = false, prefix = '') {
    return items.filter(canShowItem).map(item => {
      const Icon = item.icon
      const key = `${prefix}/${item.label}`
      const hasChildren = Boolean(item.children?.length)
      const expanded = Boolean(openGroups[key])
      const active = pathMatches(item.path) && (!item.dashboardMode || dashboardMode === item.dashboardMode)
      const showBadge = item.pendingBadge && pendingCount > 0
      const breakdownEntries = showBadge ? Object.entries(PENDING_STATUS_LABELS).map(([key, label]) => ({ key, label, count: Number(pendingBreakdown[key]) || 0 })) : []
      return <div key={key}>
        <button type="button" onClick={() => hasChildren ? setOpenGroups(value => ({ ...value, [key]: !value[key] })) : visit(item)}
          aria-expanded={hasChildren ? expanded : undefined} aria-controls={hasChildren ? sectionId(key) : undefined} aria-current={active ? 'page' : undefined}
          className={`sidebar-menu-button relative flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors ${active ? 'bg-[#f45b0b] text-white' : light ? 'text-slate-700 hover:bg-emerald-50' : 'text-emerald-50/90 hover:bg-white/10'}`}>
          <Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{item.label}</span>
          {showBadge && <span className="group/badge relative ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-white/20" aria-label={`${pendingCount} pending applications`}>{pendingCount > 99 ? '99+' : pendingCount}<span role="tooltip" className="pointer-events-none absolute right-0 top-full z-[60] mt-2 w-56 translate-y-1 rounded-xl border border-emerald-100 bg-white p-3 text-left shadow-2xl shadow-slate-900/20 opacity-0 transition-all duration-150 group-hover/badge:translate-y-0 group-hover/badge:opacity-100"><span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-emerald-700">Pending Breakdown</span><ul className="space-y-1">{breakdownEntries.map(({ label, count }) => <li key={label} className="flex items-center justify-between text-xs font-bold text-slate-700"><span>{label}</span><span className={`rounded-full px-2 py-0.5 ${count > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-400'}`}>{count}</span></li>)}</ul><span className="mt-2 block border-t border-slate-100 pt-2 text-right text-[11px] font-black text-emerald-700">Total: {pendingCount}</span></span></span>}
          {hasChildren && <ChevronDown className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />}
        </button>
        {hasChildren && expanded && <div id={sectionId(key)} className="sidebar-section-reveal ml-4 mt-1 space-y-1 border-l border-current/15 pl-2">{renderItems(item.children, light, key)}</div>}
      </div>
    })
  }
  function toggleSection(section, event) {
    if (!collapsed) { setOpenSection(value => value === section.label ? null : section.label); return }
    triggerRef.current = event.currentTarget
    const bounds = event.currentTarget.getBoundingClientRect()
    setOpenGroups({})
    setFlyout(value => value?.label === section.label ? null : {
      label: section.label, left: bounds.right + 12, top: Math.max(12, Math.min(bounds.top, window.innerHeight - 440))
    })
  }
  const visibleSections = navSections.map((section, index) => ({ ...section, icon: sectionIcons[index] })).filter(section => section.items.some(canShowItem))
  const selectedSection = visibleSections.find(section => section.label === flyout?.label)

  // A section with a single childless item renders directly as a top-level
  // button (no collapsible header) so it stays immediately visible.
  const isDirectItemSection = section => section.items.length === 1 && !section.items[0]?.children?.length

  return <div ref={sidebarRef} className="relative flex h-full min-h-0 flex-col bg-[#16805f] pt-4 text-white">
    <div className={`flex h-9 shrink-0 items-center ${collapsed ? 'justify-center px-2' : 'justify-between px-5'}`}>
      {!collapsed && <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-100/70">Navigation</p>}
      <button type="button" onClick={onToggleCollapsed} className={`hidden h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#116c51] transition hover:bg-[#0f6048] lg:inline-flex ${collapsed ? 'rotate-180' : ''}`} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><ChevronsLeft className="h-4 w-4" /></button>
      <button type="button" onClick={onClose} className="ml-auto rounded-xl p-2 hover:bg-white/10 lg:hidden" aria-label="Close sidebar"><X className="h-5 w-5" /></button>
    </div>
    <nav aria-label="Main navigation" className={`sidebar-scrollbar flex-1 overflow-y-auto pb-5 pt-5 ${collapsed ? 'space-y-2 px-2' : 'space-y-5 px-4'}`} onScroll={() => setFlyout(null)}>
      {visibleSections.map(section => {
        const Icon = section.icon
        const expanded = collapsed ? flyout?.label === section.label : openSection === section.label
        const active = section.items.some(containsRoute)
        if (isDirectItemSection(section)) {
          return <div key={section.label}>{renderItems(sectionItems(section), false, section.label)}</div>
        }
        return <div key={section.label}>
          <button type="button" onClick={event => toggleSection(section, event)} aria-label={section.label} aria-expanded={Boolean(expanded)} aria-controls={sectionId(section.label)} title={collapsed ? section.label : undefined}
            className={collapsed
              ? `flex min-h-12 w-full items-center justify-center rounded-2xl transition-colors ${expanded ? 'bg-white/20' : active ? 'bg-white/10' : 'hover:bg-white/10'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200`
              : 'flex w-full items-center justify-between gap-2 border-b border-white/15 px-1 pb-2 text-left text-[11px] font-black uppercase tracking-[0.16em] text-emerald-100/80 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-200'}>
            {collapsed ? <Icon className="h-5 w-5" /> : <><span>{section.label}</span><ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`} /></>}
          </button>
          {!collapsed && expanded && <div id={sectionId(section.label)} className="sidebar-section-reveal mt-3 space-y-1">{renderItems(sectionItems(section), false, section.label)}</div>}
        </div>
      })}
    </nav>
    {collapsed && selectedSection && createPortal(<div ref={flyoutRef} id={sectionId(selectedSection.label)} role="region" aria-label={selectedSection.label} className="sidebar-section-reveal fixed z-[100] w-72 overflow-y-auto rounded-2xl border border-emerald-100 bg-white p-3 text-slate-900 shadow-2xl shadow-slate-900/20" style={{ left: flyout.left, top: flyout.top, maxHeight: `calc(100dvh - ${flyout.top + 16}px)`, maxWidth: `calc(100vw - ${flyout.left + 12}px)` }}>
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 px-2 pb-3"><h2 className="text-xs font-black uppercase tracking-wider text-emerald-800">{selectedSection.label}</h2><button type="button" onClick={() => { setFlyout(null); triggerRef.current?.focus() }} aria-label="Close section" className="rounded-lg p-1 hover:bg-emerald-50"><X className="h-4 w-4" /></button></div>
      <div className="space-y-1">{renderItems(sectionItems(selectedSection), true, selectedSection.label)}</div>
    </div>, document.body)}
  </div>
}
