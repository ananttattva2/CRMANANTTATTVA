const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shellPath = path.resolve(__dirname, '../../frontend/src/components/dashboard/DashboardShell.jsx');
const sidebarPath = path.resolve(__dirname, '../../frontend/src/components/dashboard/Sidebar.jsx');

test('desktop sidebar expands and shifts content instead of covering page controls', () => {
  const shell = fs.readFileSync(shellPath, 'utf8');
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');

  assert.match(shell, /sidebarCollapsed \? 'lg:w-\[84px\]' : 'lg:w-\[296px\]'/);
  assert.match(shell, /sidebarCollapsed \? 'lg:ml-\[84px\]' : 'lg:ml-\[296px\]'/);
  assert.match(sidebar, /if \(collapsed\) \{[\s\S]*setOpenGroups\([\s\S]*onToggleCollapsed\?\.\(\)/);
  assert.doesNotMatch(sidebar, /if \(collapsed\) \{\s*setActiveFlyout\(\(value\)/);
});

test('Application Dashboard remains visible to ordinary authenticated users', () => {
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');
  const dashboardNavigation = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/constants/dashboard.js'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.jsx'), 'utf8');

  assert.match(sidebar, /if \(item\.label === 'Dashboard'\) return true/);
  assert.match(sidebar, /label: 'Application Dashboard'[\s\S]*path: '\/overall-dashboard'/);
  assert.match(dashboardNavigation, /label: 'Pending Applications', icon: Clock3, path: '\/overall-dashboard\?view=pending-applications'/);
  assert.match(app, /path="\/overall-dashboard" element=\{<ProtectedRoute><OverallDashboard\/><\/ProtectedRoute>\}/);
  assert.doesNotMatch(app, /path="\/overall-dashboard"[^\n]*allowedRoles/);
});
