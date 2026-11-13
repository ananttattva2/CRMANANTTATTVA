const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

test('dashboard tabs use exact Sales matching and expose one selected tab', () => {
  const component = fs.readFileSync(path.join(root, 'frontend/src/components/dashboard/DashboardViewTabs.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'frontend/src/styles/dashboard-view-tabs.css'), 'utf8');
  assert.match(component, /path !== '\/summary-dashboard'/);
  assert.match(component, /end=\{path === '\/summary-dashboard'\}/);
  assert.match(component, /aria-selected=\{selected\}/);
  assert.match(component, /className=\{selected \? 'is-active' : ''\}/);
  assert.match(styles, /a:not\(\.is-active\):hover/);
  assert.match(styles, /a\.is-active/);
});
