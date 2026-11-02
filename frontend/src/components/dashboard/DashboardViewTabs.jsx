import React from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import '../../styles/dashboard-view-tabs.css';

const TABS = [
  { label: 'Sales', path: '/sales/lead-pipeline', icon: TrendingUp },
  { label: 'Operations', path: '/summary-dashboard', icon: BarChart3 }
];

export default function DashboardViewTabs() {
  return <nav className="dashboard-view-tabs" aria-label="Summary dashboard section">
    <span className="dashboard-view-tabs__label">Dashboard View</span>
    <div role="tablist" aria-label="Sales and Operations dashboards">
      {TABS.map(({ label, path, icon: Icon }) => <NavLink
        key={path}
        to={path}
        role="tab"
        aria-label={`${label} dashboard`}
        className={({ isActive }) => isActive ? 'is-active' : ''}
      ><Icon aria-hidden="true" />{label}</NavLink>)}
    </div>
  </nav>;
}
