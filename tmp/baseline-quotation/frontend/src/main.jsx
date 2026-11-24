import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
import './styles/modules/01-foundation-and-shared.css'
import './styles/modules/02-auth-leads-and-client-detail.css'
import './styles/modules/03-annual-workspace.css'
import './styles/modules/04-forms-tables-and-controls.css'
import './styles/modules/05-dashboard-layout.css'
import './styles/modules/06-dashboard-widgets.css'
import './styles/modules/07-sales-lead-generation.css'
import './styles/modules/08-client-master-directory.css'
import './styles/modules/09-notifications-calendar.css'
import './styles/modules/10-responsive-polish.css'
import './styles/modules/11-final-overrides.css'
import './styles/modules/13-internal-teams.css'
import './styles/modules/14-desktop-density.css'
import './styles/modules/15-mobile-system.css'
import './styles/modules/16-support-milestone.css'
import './styles/modules/12-typography-system.css'
import { applyThemeSettings } from './components/dashboard/SettingsDrawer'

window.addEventListener('unhandledrejection', (event) => {
  if (window.__CRM_SHOULD_IGNORE_BROWSER_NOISE__?.(event.reason)) {
    event.preventDefault()
  }
}, true)

try {
  applyThemeSettings(JSON.parse(localStorage.getItem('crm_theme_settings') || '{}'))
} catch {
  applyThemeSettings({})
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
