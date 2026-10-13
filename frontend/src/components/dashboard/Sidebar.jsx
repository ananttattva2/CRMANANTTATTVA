import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, BriefcaseBusiness, ChevronDown, ChevronsLeft, Gauge, X } from 'lucide-react'
import { adminRoles, hasAnyRole, navSections } from '../../constants/dashboard'

export default function Sidebar({ currentUser, collapsed, onToggleCollapsed, onClose, dashboardMode = 'operations', onDashboardModeChange }) {
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = `${location.pathname}${location.search}`
  const [openGroups, setOpenGroups] = useState({ Home: true, Sales: true })
  const [activeFlyout, setActiveFlyout] = useState(null)
  const [activeItem, setActiveItem] = useState('User Management')
  const isDashboardRoute = ['/dashboard', '/overall-dashboard', '/superadmin-dashboard', '/mis', '/mis/complete', '/mis/client-daily'].includes(location.pathname)
  const [dashboardChoicesOpen, setDashboardChoicesOpen] = useState(() => isDashboardRoute)
  const [openNestedGroups, setOpenNestedGroups] = useState(() => ({
    'Pending Leads': location.pathname.startsWith('/pending-leads'),
    Tickets: location.pathname.includes('tickets')
  }))

  function toggleGroup(item, hasChildren) {
    const label = item.label
    setActiveItem(label)
    if (item.path) {
      navigate(item.path)
      onClose?.()
    }

    if (!hasChildren) return

    if (collapsed) {
      setActiveFlyout(null)
      setOpenGroups((value) => ({ ...value, [label]: true }))
      onToggleCollapsed?.()
      return
    }

    setOpenGroups((value) => ({ ...value, [label]: !value[label] }))
  }

  function pathMatches(path) {
    if (!path) return false
    return path.includes('?') ? path === currentPath : path === location.pathname && !location.search
  }

  function canShowItem(item) {
    if (Array.isArray(item.roles) && !hasAnyRole(currentUser, item.roles)) return false
    if (item.label !== 'User Management') return true
    return hasAnyRole(currentUser, adminRoles)
  }

  const canChooseDashboard = hasAnyRole(currentUser, adminRoles)

  function chooseDashboard(mode) {
    onDashboardModeChange?.(mode)
    setActiveItem(mode === 'sales' ? 'Sales Dashboard' : 'Operations Dashboard')
    navigate('/dashboard')
    onClose?.()
  }

  function renderDashboardReports(child, flyout = false) {
    return child.children.filter(canShowItem).map((entry) => {
      const EntryIcon = entry.icon
      const active = pathMatches(entry.path)
      return <button key={entry.path} type="button" onClick={() => { setActiveItem(entry.label); navigate(entry.path); setActiveFlyout(null); onClose?.() }} aria-current={active ? 'page' : undefined} className={flyout
        ? `flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-black transition ${active ? 'bg-[#f45b0b] text-white' : 'text-slate-700 hover:bg-emerald-50 hover:text-[#0f5d46]'}`
        : `sidebar-dashboard-choice flex min-h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black transition ${active ? 'sidebar-dashboard-choice-active bg-[#f45b0b] text-white' : 'text-emerald-50/75 hover:bg-white/10 hover:text-white'}`}><EntryIcon className={flyout ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0'} /><span>{entry.label}</span></button>
    })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-visible bg-[#16805f] pt-4 text-white">
      {!collapsed && <div className="border-b border-white/10 px-5 pb-4 pr-16 lg:hidden"><p className="text-[10px] font-black uppercase tracking-[.22em] text-emerald-200">Workspace</p><strong className="mt-1 block text-lg font-black">CRM Navigation</strong><span className="mt-1 block truncate text-xs font-semibold text-emerald-100/70">{currentUser?.name || currentUser?.email}</span></div>}
      <div className={`relative z-50 hidden h-9 shrink-0 items-center lg:flex ${collapsed ? 'justify-center px-2' : 'justify-between px-5'}`}>
        {!collapsed && <p className="text-xs font-black uppercase leading-none tracking-[0.24em] text-emerald-100/70">Navigation</p>}
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={`btn-lift inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-[#116c51] text-white shadow-lg shadow-emerald-950/15 transition hover:bg-[#0f6048] ${collapsed ? 'rotate-180' : ''}`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronsLeft className="h-4 w-4 transition-transform duration-300" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-0 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/15 lg:hidden"
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className={`sidebar-scrollbar flex-1 space-y-5 px-3 pb-5 ${collapsed ? 'overflow-visible px-2 pt-5' : 'overflow-y-auto px-4 pt-5'}`}>
        {navSections.map((section) => (
          <div key={section.label}>
            {!collapsed && section.label !== 'Operations' && <p className="mb-4 px-1 text-xs font-black uppercase tracking-[0.24em] text-emerald-100/70">{section.label}</p>}
            <div className="space-y-2">
              {section.items.filter(canShowItem).map((item) => {
                const Icon = item.icon
                const isOpen = Boolean(openGroups[item.label])
                const hasChildren = Boolean(item.children?.length)
                const isFlyoutOpen = activeFlyout === item.label
                // Child routes already have their own active treatment. Keep the
                // parent highlighted only when the parent itself is selected.
                const isPrimaryActive = activeItem === item.label || pathMatches(item.path)
                return (
                  <div key={item.label} className="relative">
                    <button
                      type="button"
                      onClick={() => toggleGroup(item, hasChildren)}
                      className={`sidebar-menu-button group flex min-h-12 w-full items-center rounded-[18px] text-left font-black transition-all duration-200 ${
                        collapsed ? 'justify-center px-0' : 'justify-between px-4'
                      } ${
                        isPrimaryActive
                          ? 'sidebar-menu-button-active bg-[#f45b0b] text-white shadow-xl shadow-orange-950/20'
                          : 'text-white hover:bg-white/10'
                      }`}
                      aria-expanded={hasChildren ? (collapsed ? isFlyoutOpen : isOpen) : undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}>
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
                      </span>
                      {hasChildren && !collapsed && (
                        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                      )}
                    </button>

                    {hasChildren && !collapsed && (
                      <div className={`grid transition-all duration-300 ease-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                        <div className="overflow-hidden">
                          <div className="mt-2 space-y-1 pl-6">
                            {item.children.filter(canShowItem).map((child) => {
                              const ChildIcon = child.icon
                              const isDashboardChild = child.label === 'Dashboard'
                              const isChildActive = child.path ? pathMatches(child.path) : activeItem === child.label
                              if (child.children?.length && !isDashboardChild) {
                                const nestedActive = child.children.some((entry) => pathMatches(entry.path))
                                return (
                                  <div key={child.label}>
                                    <button type="button" onClick={() => setOpenNestedGroups((value) => ({ ...value, [child.label]: !value[child.label] }))} className={`sidebar-child-button flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-black transition ${nestedActive ? 'bg-white/14 text-white' : 'text-emerald-50/78 hover:bg-white/10 hover:text-white'}`}>
                                      <span className="flex items-center gap-3"><ChildIcon className="h-4 w-4 shrink-0" />{child.label}</span>
                                      <ChevronDown className={`h-4 w-4 transition ${openNestedGroups[child.label] ? 'rotate-180' : ''}`} />
                                    </button>
                                    {openNestedGroups[child.label] && <div className="mt-1 grid gap-1 pl-6">{child.children.map((entry) => { const EntryIcon = entry.icon; return <button type="button" key={entry.label} onClick={() => { setActiveItem(entry.label); navigate(entry.path); onClose?.() }} className={`flex min-h-9 items-center gap-2 rounded-xl px-3 text-left text-xs font-black ${pathMatches(entry.path) ? 'bg-[#f45b0b] text-white' : 'text-emerald-50/75 hover:bg-white/10'}`}><EntryIcon className="h-3.5 w-3.5" />{entry.label}</button> })}</div>}
                                  </div>
                                )
                              }
                              if (isDashboardChild) {
                                return (
                                  <div key={child.label}>
                                    <button
                                      type="button"
                                      onClick={() => setDashboardChoicesOpen((value) => !value)}
                                      className={`sidebar-child-button flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-black transition ${
                                        isDashboardRoute
                                          ? 'sidebar-child-button-current bg-white/14 text-white'
                                          : 'text-emerald-50/78 hover:bg-white/10 hover:text-white'
                                      }`}
                                      aria-expanded={dashboardChoicesOpen}
                                    >
                                      <span className="flex items-center gap-3">
                                        <ChildIcon className="h-4 w-4 shrink-0" />
                                        Dashboard
                                      </span>
                                      <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${dashboardChoicesOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    {dashboardChoicesOpen && (
                                      <div className="mt-1 grid gap-1 pl-5">
                                        <button type="button" onClick={() => { setActiveItem('Overall Dashboard'); navigate('/overall-dashboard'); onClose?.() }} aria-current={location.pathname === '/overall-dashboard' ? 'page' : undefined} className={`sidebar-dashboard-choice flex min-h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black transition ${location.pathname === '/overall-dashboard' ? 'sidebar-dashboard-choice-active bg-[#f45b0b] text-white' : 'text-emerald-50/75 hover:bg-white/10 hover:text-white'}`}><BarChart3 className="h-3.5 w-3.5" />Overall Dashboard</button>
                                        {canChooseDashboard && <>
                                        <button
                                          type="button"
                                          onClick={() => chooseDashboard('operations')}
                                          className={`sidebar-dashboard-choice flex min-h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black transition ${
                                            dashboardMode === 'operations' && location.pathname === '/dashboard'
                                              ? 'sidebar-dashboard-choice-active bg-[#f45b0b] text-white'
                                              : 'text-emerald-50/75 hover:bg-white/10 hover:text-white'
                                          }`}
                                        >
                                          <Gauge className="h-3.5 w-3.5" />
                                          Operations Dashboard
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => chooseDashboard('sales')}
                                          className={`sidebar-dashboard-choice flex min-h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black transition ${
                                            dashboardMode === 'sales' && location.pathname === '/dashboard'
                                              ? 'sidebar-dashboard-choice-active bg-[#f45b0b] text-white'
                                              : 'text-emerald-50/75 hover:bg-white/10 hover:text-white'
                                          }`}
                                        >
                                          <BriefcaseBusiness className="h-3.5 w-3.5" />
                                          Sales Dashboard
                                        </button>
                                        </>}
                                        {renderDashboardReports(child)}
                                      </div>
                                    )}
                                  </div>
                                )
                              }
                              return (
                                <button
                                  type="button"
                                  key={child.label}
                                  onClick={() => {
                                    setActiveItem(child.label)
                                    if (child.path) {
                                      navigate(child.path)
                                      onClose?.()
                                    }
                                  }}
                                  className={`sidebar-child-button flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-black transition ${
                                    isChildActive
                                      ? 'sidebar-child-button-current bg-[#f45b0b] text-white'
                                      : 'text-emerald-50/78 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <ChildIcon className="h-4 w-4 shrink-0" />
                                  {child.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {hasChildren && collapsed && isFlyoutOpen && (
                      <div className="absolute left-[68px] top-0 z-50 w-56 rounded-xl border border-slate-100 bg-white p-2 text-slate-900 shadow-2xl shadow-slate-900/15">
                        <div className="px-3 py-2 font-black text-slate-900">{item.label}</div>
                        {item.children.filter(canShowItem).map((child) => {
                          const ChildIcon = child.icon
                          const isDashboardChild = child.label === 'Dashboard'
                          const isChildActive = child.path ? pathMatches(child.path) : activeItem === child.label
                          if (child.children?.length && !isDashboardChild) {
                            return (
                              <div key={child.label} className="rounded-lg bg-slate-50 p-1">
                                <div className="px-2 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-400">{child.label}</div>
                                {child.children.map((entry) => {
                                  const EntryIcon = entry.icon
                                  return (
                                    <button
                                      type="button"
                                      key={entry.label}
                                      onClick={() => {
                                        setActiveItem(entry.label)
                                        navigate(entry.path)
                                        setActiveFlyout(null)
                                        onClose?.()
                                      }}
                                      className={`mt-1 flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-black ${
                                        pathMatches(entry.path) ? 'bg-[#f45b0b] text-white' : 'text-slate-600 hover:bg-white'
                                      }`}
                                    >
                                      <EntryIcon className="h-4 w-4" />
                                      {entry.label}
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          }
                          if (isDashboardChild) {
                            return (
                              <div key={child.label} className="rounded-lg bg-slate-50 p-1">
                                <div className="px-2 py-1 text-xs font-black uppercase tracking-[0.12em] text-slate-400">Dashboard</div>
                                <button type="button" onClick={() => { setActiveItem('Overall Dashboard'); navigate('/overall-dashboard'); setActiveFlyout(null); onClose?.() }} aria-current={location.pathname === '/overall-dashboard' ? 'page' : undefined} className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-black transition ${location.pathname === '/overall-dashboard' ? 'bg-[#f45b0b] text-white' : 'text-slate-700 hover:bg-emerald-50 hover:text-[#0f5d46]'}`}><BarChart3 className="h-4 w-4 shrink-0" />Overall Dashboard</button>
                                {canChooseDashboard && <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    chooseDashboard('operations')
                                    setActiveFlyout(null)
                                  }}
                                  className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-black transition ${
                                    dashboardMode === 'operations' && location.pathname === '/dashboard'
                                      ? 'bg-[#f45b0b] text-white'
                                      : 'text-slate-700 hover:bg-emerald-50 hover:text-[#0f5d46]'
                                  }`}
                                >
                                  <Gauge className="h-4 w-4 shrink-0" />
                                  Operations Dashboard
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    chooseDashboard('sales')
                                    setActiveFlyout(null)
                                  }}
                                  className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-black transition ${
                                    dashboardMode === 'sales' && location.pathname === '/dashboard'
                                      ? 'bg-[#f45b0b] text-white'
                                      : 'text-slate-700 hover:bg-emerald-50 hover:text-[#0f5d46]'
                                  }`}
                                >
                                  <BriefcaseBusiness className="h-4 w-4 shrink-0" />
                                  Sales Dashboard
                                </button>
                                </>}
                                {renderDashboardReports(child, true)}
                              </div>
                            )
                          }
                          return (
                            <button
                              type="button"
                              key={child.label}
                              onClick={() => {
                                setActiveItem(child.label)
                                if (child.path) {
                                  navigate(child.path)
                                  onClose?.()
                                }
                                setActiveFlyout(null)
                              }}
                              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-black transition ${
                                isChildActive
                                  ? 'bg-[#f45b0b] text-white'
                                  : 'text-slate-700 hover:bg-emerald-50 hover:text-[#0f5d46]'
                              }`}
                            >
                              <ChildIcon className="h-4 w-4 shrink-0" />
                              {child.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

    </div>
  )
}
