import React from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import '../../styles/dashboard-view-tabs.css';

const TABS = [
  { label: 'Sales', path: '/summary-dashboard', aliases: ['/sales/lead-pipeline'], icon: TrendingUp },
  { label: 'Operations', path: '/summary-dashboard/operations', icon: BarChart3 }
];

export default function DashboardViewTabs() {
  const { pathname } = useLocation();
  return <nav className="dashboard-view-tabs" aria-label="Summary dashboard section">
    <span className="dashboard-view-tabs__label">Dashboard View</span>
    <div role="tablist" aria-label="Sales and Operations dashboards">
      {TABS.map(({ label, path, aliases = [], icon: Icon }) => <NavLink
        key={path}
        to={path}
        role="tab"
        aria-label={`${label} dashboard`}
        className={({ isActive }) => isActive || aliases.includes(pathname) ? 'is-active' : ''}
      ><Icon aria-hidden="true" />{label}</NavLink>)}
    </div>
  </nav>;
}
