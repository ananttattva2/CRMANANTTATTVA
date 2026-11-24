import React, { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Moon, Sun, X } from 'lucide-react'

export const defaultThemeSettings = {
  colorMode: 'light',
  layout: 'default',
  layoutWidth: 'fluid',
  cardLayout: 'bordered',
  sidebarSize: 'default',
  sidebarColor: '#16805f',
  topbarColor: '#ffffff',
  themeColor: '#30737B'
}

const solidColors = ['#ffffff', '#f3f4f6', '#07110f', '#30737B', '#059669', '#f59e0b', '#2f80ed', '#3730c9']
const gradientColors = [
  'linear-gradient(135deg, #7c3aed, #4c1d95)',
  'linear-gradient(135deg, #22c1dc, #0f5fa8)',
  'linear-gradient(135deg, #2ca39b, #0f6f78)',
  'linear-gradient(135deg, #456b8d, #1f3449)',
  'linear-gradient(135deg, #bd18ae, #8a087f)',
  'linear-gradient(135deg, #ff9472, #f45f5f)',
  'linear-gradient(135deg, #4f79f6, #2d158f)'
]
const themeColors = ['#30737B', '#059669', '#159a87', '#f59e0b', '#8a007d', '#3730c9', '#2f80ed']

const layoutOptions = ['Default', 'Mini', 'Horizontal', 'Horizontal Single', 'Detached', 'Two Column', 'Without Header', 'Overlay', 'Menu Aside', 'Menu Stacked', 'Modern', 'Transparent', 'RTL']
const sidebarSizes = ['Default', 'Compact', 'Hover View']

function normalizeSettings(value = {}) {
  const next = { ...defaultThemeSettings, ...value }
  if (String(next.themeColor).toLowerCase() === '#ef1d0f') next.themeColor = defaultThemeSettings.themeColor
  if (String(next.sidebarColor).toLowerCase() === '#0f5d46') next.sidebarColor = defaultThemeSettings.sidebarColor
  return next
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem('crm_theme_settings') || '{}'))
  } catch {
    return defaultThemeSettings
  }
}

export function applyThemeSettings(settings) {
  const next = normalizeSettings(settings)
  const root = document.documentElement

  root.dataset.crmColorMode = next.colorMode
  root.dataset.crmLayout = next.layout
  root.dataset.crmLayoutWidth = next.layoutWidth
  root.dataset.crmCardLayout = next.cardLayout
  root.dataset.crmSidebarSize = next.sidebarSize
  root.style.setProperty('--crm-theme-color', next.themeColor)
  root.style.setProperty('--crm-sidebar-color', next.sidebarColor)
  root.style.setProperty('--crm-topbar-color', next.topbarColor)
}

export default function SettingsDrawer({ open, onClose }) {
  const [settings, setSettings] = useState(defaultThemeSettings)
  const [openSections, setOpenSections] = useState({
    colorMode: true,
    layouts: true,
    width: true,
    card: true,
    sidebarSize: true,
    sidebarColor: true,
    topbarColor: true,
    theme: true
  })

  useEffect(() => {
    const saved = readSettings()
    setSettings(saved)
    applyThemeSettings(saved)
  }, [])

  function update(nextPatch) {
    const next = normalizeSettings({ ...settings, ...nextPatch })
    setSettings(next)
    localStorage.setItem('crm_theme_settings', JSON.stringify(next))
    applyThemeSettings(next)
  }

  function resetSettings() {
    setSettings(defaultThemeSettings)
    localStorage.setItem('crm_theme_settings', JSON.stringify(defaultThemeSettings))
    applyThemeSettings(defaultThemeSettings)
  }

  function toggle(section) {
    setOpenSections((value) => ({ ...value, [section]: !value[section] }))
  }

  const sections = useMemo(() => [
    {
      id: 'colorMode',
      title: 'Color Mode',
      body: (
        <div className="settings-choice-row">
          <ChoiceButton active={settings.colorMode === 'light'} onClick={() => update({ colorMode: 'light' })} icon={Sun} label="Light Mode" />
          <ChoiceButton active={settings.colorMode === 'dark'} onClick={() => update({ colorMode: 'dark' })} icon={Moon} label="Dark Mode" />
        </div>
      )
    },
    {
      id: 'layouts',
      title: 'Select Layouts',
      body: (
        <div className="settings-layout-grid">
          {layoutOptions.map((label) => (
            <LayoutTile key={label} label={label} active={settings.layout === slug(label)} onClick={() => update({ layout: slug(label) })} />
          ))}
        </div>
      )
    },
    {
      id: 'width',
      title: 'Layout Width',
      body: (
        <div className="settings-choice-row settings-choice-row-compact">
          <RadioButton active={settings.layoutWidth === 'fluid'} onClick={() => update({ layoutWidth: 'fluid' })} label="Fluid Layout" />
          <RadioButton active={settings.layoutWidth === 'boxed'} onClick={() => update({ layoutWidth: 'boxed' })} label="Boxed Layout" />
        </div>
      )
    },
    {
      id: 'card',
      title: 'Card Layout',
      body: (
        <div className="settings-layout-grid settings-layout-grid-3">
          {['Bordered', 'Borderless', 'Only Shadow'].map((label) => (
            <LayoutTile key={label} label={label} active={settings.cardLayout === slug(label)} onClick={() => update({ cardLayout: slug(label) })} />
          ))}
        </div>
      )
    },
    {
      id: 'sidebarSize',
      title: 'Sidebar Size',
      body: (
        <div className="settings-layout-grid settings-layout-grid-3">
          {sidebarSizes.map((label) => (
            <LayoutTile key={label} label={label} active={settings.sidebarSize === slug(label)} onClick={() => update({ sidebarSize: slug(label) })} />
          ))}
        </div>
      )
    },
    {
      id: 'sidebarColor',
      title: 'Sidebar Color',
      body: <ColorPicker value={settings.sidebarColor} onChange={(sidebarColor) => update({ sidebarColor })} />
    },
    {
      id: 'topbarColor',
      title: 'Top Bar Color',
      body: <ColorPicker value={settings.topbarColor} onChange={(topbarColor) => update({ topbarColor })} />
    },
    {
      id: 'theme',
      title: 'Theme Colors',
      body: (
        <div className="settings-swatch-grid">
          {themeColors.map((color) => <Swatch key={color} value={color} active={settings.themeColor === color} onClick={() => update({ themeColor: color })} />)}
        </div>
      )
    }
  ], [settings])

  return (
    <>
      <button type="button" className={`settings-drawer-backdrop ${open ? 'settings-drawer-backdrop-open' : ''}`} onClick={onClose} aria-label="Close settings" />
      <aside className={`settings-drawer ${open ? 'settings-drawer-open' : ''}`} aria-hidden={!open}>
        <header className="settings-drawer-head">
          <h2>Theme Customizer</h2>
          <div>
            <button type="button" className="settings-reset-btn" onClick={resetSettings}>Reset</button>
            <button type="button" onClick={onClose} aria-label="Close settings">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="settings-drawer-body">
          {sections.map((section) => (
            <section key={section.id} className="settings-section">
              <button type="button" className="settings-section-head" onClick={() => toggle(section.id)}>
                <span>{section.title}</span>
                <ChevronDown className={`h-4 w-4 ${openSections[section.id] ? 'rotate-180' : ''}`} />
              </button>
              {openSections[section.id] && <div className="settings-section-body">{section.body}</div>}
            </section>
          ))}
        </div>
      </aside>
    </>
  )
}

function ChoiceButton({ active, onClick, icon: Icon, label }) {
  return (
    <button type="button" onClick={onClick} className={`settings-choice ${active ? 'settings-choice-active' : ''}`}>
      <Icon className="h-5 w-5" />
      <span>{label}</span>
      {active && <Check className="settings-check h-4 w-4" />}
    </button>
  )
}

function RadioButton({ active, onClick, label }) {
  return (
    <button type="button" onClick={onClick} className={`settings-radio ${active ? 'settings-radio-active' : ''}`}>
      <span />
      {label}
    </button>
  )
}

function LayoutTile({ active, onClick, label }) {
  return (
    <button type="button" onClick={onClick} className={`settings-layout-tile ${active ? 'settings-layout-active' : ''}`}>
      <span className="settings-layout-preview">
        <i />
        <b />
      </span>
      <span>{label}</span>
      {active && <Check className="settings-layout-check h-4 w-4" />}
    </button>
  )
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="settings-color-stack">
      <p>Solid Colors</p>
      <div className="settings-swatch-grid">
        {solidColors.map((color) => <Swatch key={color} value={color} active={value === color} onClick={() => onChange(color)} />)}
      </div>
      <p>Gradient Colors</p>
      <div className="settings-swatch-grid">
        {gradientColors.map((color) => <Swatch key={color} value={color} active={value === color} onClick={() => onChange(color)} />)}
      </div>
    </div>
  )
}

function Swatch({ value, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className="settings-swatch" style={{ background: value }} aria-label={`Use ${value}`}>
      {active && <Check className="h-5 w-5" />}
    </button>
  )
}

function slug(value) {
  return String(value).toLowerCase().replace(/\s+/g, '-')
}
