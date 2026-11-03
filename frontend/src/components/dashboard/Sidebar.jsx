import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, BriefcaseBusiness, ChevronDown, ChevronsLeft, ClipboardList, FileText, Gauge, LifeBuoy, MessagesSquare, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import { adminRoles, hasAnyRole, navSections } from '../../constants/dashboard'
import './Sidebar.css'

const sectionIcons = [BarChart3, ClipboardList, UserRound, FileText, ShieldCheck, ClipboardList, MessagesSquare, Users, LifeBuoy]
const sectionId = label => `nav-section-${label.replace(/[^a-z0-9]/gi, '-')}`

export default function Sidebar({ currentUser, collapsed, onToggleCollapsed, onClose, dashboardMode = 'operations', onDashboardModeChange }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [openSection, setOpenSection] = useState(null)
  const [openGroups, setOpenGroups] = useState({})
  const [flyout, setFlyout] = useState(null)
  const sidebarRef = useRef(null)
  const flyoutRef = useRef(null)
  const triggerRef = useRef(null)
  const currentPath = `${location.pathname}${location.search}`
  const canChooseDashboard = hasAnyRole(currentUser, adminRoles)

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
    return !item.children?.length || item.children.some(canShowItem)
  }
  function containsRoute(item) { return pathMatches(item.path) || item.children?.some(containsRoute) }
  function visit(item) {
    if (item.dashboardMode) onDashboardModeChange?.(item.dashboardMode)
    navigate(item.path)
    setFlyout(null)
    onClose?.()
  }
  function sectionItems(section) {
    return section.items.filter(canShowItem).flatMap(item => item.label === 'Dashboard' ? [
      { label: 'Application Dashboard', icon: BarChart3, path: '/overall-dashboard' },
      canChooseDashboard
        ? { label: 'Sales Dashboard', icon: BriefcaseBusiness, path: '/dashboard', dashboardMode: 'sales' }
        : { label: 'My Dashboard', icon: Gauge, path: '/dashboard' },
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
      return <div key={key}>
        <button type="button" onClick={() => hasChildren ? setOpenGroups(value => ({ ...value, [key]: !value[key] })) : visit(item)}
          aria-expanded={hasChildren ? expanded : undefined} aria-controls={hasChildren ? sectionId(key) : undefined} aria-current={active ? 'page' : undefined}
          className={`sidebar-menu-button flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors ${active ? 'bg-[#f45b0b] text-white' : light ? 'text-slate-700 hover:bg-emerald-50' : 'text-emerald-50/90 hover:bg-white/10'}`}>
          <Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{item.label}</span>
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
