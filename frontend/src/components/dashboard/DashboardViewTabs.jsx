import React from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import '../../styles/dashboard-view-tabs.css';

const TABS = [
  { label: 'Sales', path: '/summary-dashboard', aliases: ['/sales/lead-pipeline'], icon: TrendingUp },
  { label: 'Operations', path: '/summary-dashboard/operations', icon: BarChart3 }
];

function tabMatchesPath(pathname, path, aliases = []) {
  if (pathname === path) return true;
  if (path !== '/summary-dashboard' && pathname.startsWith(`${path}/`)) return true;
  return aliases.some((alias) => pathname === alias || pathname.startsWith(`${alias}/`));
}

export default function DashboardViewTabs() {
  const { pathname } = useLocation();
  return <nav className="dashboard-view-tabs" aria-label="Summary dashboard section">
    <span className="dashboard-view-tabs__label"><i aria-hidden="true" /><span><b>Dashboard View</b><small>Choose a workspace</small></span></span>
    <div className="dashboard-view-tabs__switcher" role="tablist" aria-label="Sales and Operations dashboards">
      {TABS.map(({ label, path, aliases = [], icon: Icon }) => {
        const selected = tabMatchesPath(pathname, path, aliases);
        return <NavLink
          key={path}
          to={path}
          end={path === '/summary-dashboard'}
          role="tab"
          aria-selected={selected}
          aria-current={selected ? 'page' : undefined}
          aria-label={`${label} dashboard`}
          className={selected ? 'is-active' : ''}
        ><span className="dashboard-view-tabs__icon"><Icon aria-hidden="true" /></span><span>{label}</span></NavLink>;
      })}
    </div>
  </nav>;
}

export { tabMatchesPath };
