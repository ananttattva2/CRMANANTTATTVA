import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, BarChart3, Building2, CalendarDays, Check, ChevronLeft, ChevronRight, FileCheck2,
  Leaf, Linkedin, LockKeyhole, Pause, Play, ShieldCheck, TrendingUp, Twitter,
  UserRound, UsersRound, Zap
} from 'lucide-react'
import '../styles/landing.css'

// Client artwork 3 is the retired Vadilal logo and must not appear in the
// public partnership carousel.
const clients = Array.from({ length: 54 }, (_, index) => index + 1).filter((client) => client !== 3)
const services = [
  { icon: UsersRound, tone: 'blue', label: 'Sales CRM', title: 'Turn every lead into a relationship.', copy: 'Capture enquiries, assign owners, follow every conversation and move opportunities forward.' },
  { icon: FileCheck2, tone: 'orange', label: 'EPR Compliance', title: 'Never miss a filing milestone.', copy: 'Keep registrations, documents, returns and approvals organised with action-ready workflows.' },
  { icon: BarChart3, tone: 'green', label: 'Operations', title: 'See work clearly. Act faster.', copy: 'Give teams one source of truth for daily tasks, productivity, ownership and real-time visibility.' }
]

// Reuse the same company artwork and chroma-key treatment as quotations.
let companyLogoPromise
function loadCompanyLogo() {
  if (!companyLogoPromise) companyLogoPromise = new Promise((resolve) => {
    const source = new Image()
    source.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = source.naturalWidth
      canvas.height = source.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(source, 0, 0)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      let left = canvas.width, top = canvas.height, right = 0, bottom = 0
      for (let index = 0; index < image.data.length; index += 4) {
        const [red, green, blue] = image.data.subarray(index, index + 3)
        const dominance = green - Math.max(red, blue)
        if (green > 75 && dominance > 14) {
          image.data[index + 3] *= dominance >= 75 ? 0 : 1 - (dominance - 14) / 61
          image.data[index + 1] = Math.min(green, Math.max(red, blue))
        }
        if (image.data[index + 3] > 128) {
          const x = (index / 4) % canvas.width, y = Math.floor(index / 4 / canvas.width)
          left = Math.min(left, x); right = Math.max(right, x)
          top = Math.min(top, y); bottom = Math.max(bottom, y)
        }
      }
      context.putImageData(image, 0, 0)
      const cropped = document.createElement('canvas')
      cropped.width = right - left + 1
      cropped.height = bottom - top + 1
      cropped.getContext('2d').drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
      resolve(cropped.toDataURL('image/png'))
    }
    source.onerror = () => resolve('/ananttattva-logo.png')
    source.src = '/anant-tattva-logo-chroma.png'
  })
  return companyLogoPromise
}

function Wordmark({ inverse = false, compact = false }) {
  const [logo, setLogo] = useState('')
  useEffect(() => {
    let active = true
    loadCompanyLogo().then((url) => { if (active) setLogo(url) })
    return () => { active = false }
  }, [])
  return <span className={`lp-wordmark ${inverse ? 'inverse' : ''} ${compact ? 'compact' : ''}`}>
    {logo && <img src={logo} alt="Anant Tattva" width={compact ? 78 : 150} height={compact ? 28 : 46} />}
  </span>
}

const clientLogoCache = new Map()
function ClientLogo({ client, duplicate }) {
  const original = `/clients/${client}.png`
  const [src, setSrc] = useState(original)
  useEffect(() => {
    let active = true
    if (!clientLogoCache.has(client)) clientLogoCache.set(client, new Promise((resolve) => {
      const image = new Image()
      image.onload = () => {
        // Fit the visible artwork, rather than the large white margins in the files.
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        let left = canvas.width, top = canvas.height, right = -1, bottom = -1
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] > 32 && Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 235) {
            const x = (index / 4) % canvas.width, y = Math.floor(index / 4 / canvas.width)
            left = Math.min(left, x); right = Math.max(right, x)
            top = Math.min(top, y); bottom = Math.max(bottom, y)
          }
        }
        if (right < left) { resolve(original); return }
        left = Math.max(0, left - 5); top = Math.max(0, top - 5)
        right = Math.min(canvas.width - 1, right + 5); bottom = Math.min(canvas.height - 1, bottom + 5)
        const cropped = document.createElement('canvas')
        cropped.width = right - left + 1
        cropped.height = bottom - top + 1
        cropped.getContext('2d').drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
        resolve(cropped.toDataURL('image/png'))
      }
      image.onerror = () => resolve(original)
      image.src = original
    }))
    clientLogoCache.get(client).then((url) => { if (active) setSrc(url) })
    return () => { active = false }
  }, [client, original])
  return <img src={src} width="134" height="70" alt={duplicate ? '' : `Client logo ${client}`} loading="eager" draggable={false} />
}

function ClientScroller() {
  const row = useRef(null)
  const position = useRef(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame, previous = 0
    const tick = (time) => {
      const element = row.current
      const loopWidth = element.firstElementChild.offsetWidth
      if (previous && loopWidth) {
        position.current = (position.current + Math.min(time - previous, 64) * 0.055) % loopWidth
        element.scrollLeft = position.current
      }
      previous = time
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [paused])
  const move = (direction) => {
    const element = row.current
    const loopWidth = element.firstElementChild.offsetWidth
    position.current = ((element.scrollLeft + direction * element.clientWidth * 0.7) % loopWidth + loopWidth) % loopWidth
    element.scrollLeft = position.current
  }
  return <>
    <div className="lp-client-controls">
      <button type="button" onClick={() => move(-1)} aria-label="Previous clients"><ChevronLeft /></button>
      <button type="button" onClick={() => setPaused(!paused)} aria-label={paused ? 'Play client scroller' : 'Pause client scroller'} aria-pressed={paused}>{paused ? <Play /> : <Pause />}</button>
      <button type="button" onClick={() => move(1)} aria-label="Next clients"><ChevronRight /></button>
    </div>
    <div ref={row} className="lp-logo-row" tabIndex={0} role="region" aria-label="All 53 client logos; use arrow buttons to browse"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          move(event.key === 'ArrowLeft' ? -1 : 1)
        }
      }}>
      {[false, true].map((duplicate) => <div className="lp-client-group" key={String(duplicate)} aria-hidden={duplicate || undefined}>
        {clients.map((client) => <div className="lp-client" key={client}><ClientLogo client={client} duplicate={duplicate} /></div>)}
      </div>)}
    </div>
  </>
}

function DashboardPreview() {
  const stage = useRef(null)
  const video = useRef(null)
  const [showVideo, setShowVideo] = useState(false)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(1, entry.contentRect.width / 690)
      stage.current.style.setProperty('--lp-preview-scale', String(scale))
      stage.current.style.setProperty('--lp-preview-height', `${Math.ceil(377 * scale)}px`)
    })
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let hideTimer
    let resetTimer
    const showTimer = window.setTimeout(() => {
      if (!video.current) return
      video.current.currentTime = 0
      setShowVideo(true)
      video.current.play().catch(() => setShowVideo(false))
      hideTimer = window.setTimeout(() => {
        setShowVideo(false)
        resetTimer = window.setTimeout(() => {
          if (!video.current) return
          video.current.pause()
          video.current.currentTime = 0
        }, 700)
      }, 14000)
    }, 5000)
    return () => {
      window.clearTimeout(showTimer)
      window.clearTimeout(hideTimer)
      window.clearTimeout(resetTimer)
      video.current?.pause()
    }
  }, [])
  return <div ref={stage} className="lp-preview-stage" aria-label="Anant Tattva Business CRM dashboard preview">
    <div className="lp-preview-blob blob-one" /><div className="lp-preview-blob blob-two" />
    <div className="lp-dashboard">
      <header className="lp-dashboard-head"><Wordmark compact /><div className="lp-dash-search">Search anything...</div><span className="lp-dash-avatar">AT</span><span className="lp-dash-welcome"><small>Welcome</small><b>Anant Tattva</b></span></header>
      <div className="lp-dashboard-body">
        <aside className="lp-dash-nav"><span className="active"><BarChart3 />Overview</span><span><UsersRound />Leads</span><span><FileCheck2 />Compliance</span><span><Building2 />Clients</span><span><TrendingUp />Reports</span></aside>
        <section className="lp-dash-content">
          <div className="lp-dash-title"><span><small>Good morning <i>☀</i></small><b>Your business, at a glance.</b><em>Track. Manage. Grow. Together.</em></span><button type="button"><CalendarDays />Last 6 months</button></div>
          <div className="lp-dash-stats">
            <article><span className="aqua"><UsersRound /></span><small>Active clients</small><b>248</b><em>↑ 12% this month</em></article>
            <article><span className="blue"><TrendingUp /></span><small>Open leads</small><b>86</b><em>↑ 24% progressing</em></article>
            <article><span className="purple"><ShieldCheck /></span><small>Compliance</small><b>94%</b><em>On track</em></article>
            <article><span className="mint"><UsersRound /></span><small>Team growth</small><b>+32%</b><em>This quarter</em></article>
          </div>
          <div className="lp-dash-bottom">
            <article className="lp-performance">
              <div><b><BarChart3 /> Performance</b><span><strong>+32%</strong><small>Team growth</small></span></div>
              <svg width="560" height="145" viewBox="0 0 560 145" preserveAspectRatio="none" role="img" aria-label="Performance improving from January to June"><defs><linearGradient id="lpChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#11a98a" stopOpacity=".28"/><stop offset="1" stopColor="#11a98a" stopOpacity="0"/></linearGradient></defs><path className="lp-chart-grid" d="M0 35H560M0 75H560M0 115H560" /><path className="lp-chart-fill" d="M0 124 C55 116,88 86,145 94 S220 106,270 68 S345 78,392 59 S466 39,560 17 L560 145H0Z" /><path className="lp-chart-line" pathLength="1" d="M0 124 C55 116,88 86,145 94 S220 106,270 68 S345 78,392 59 S466 39,560 17" /></svg>
              <div className="lp-chart-months"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span></div>
            </article>
            <article className="lp-tasks"><div><span className="lp-check"><Check /></span><b>24 tasks completed<small>Today</small></b></div><ul><li><Check />Follow up with client</li><li><Check />Submit compliance docs</li><li><Check />Review new leads</li><li><Check />Update approvals</li></ul><a href="#workspace">View all tasks <ArrowRight /></a></article>
          </div>
        </section>
      </div>
      <video
        ref={video}
        className={`lp-dashboard-video ${showVideo ? 'is-visible' : ''}`}
        src="/video/MicrosoftTeams-video.mp4"
        aria-label="Anant Tattva CRM product demonstration"
        preload="auto"
        muted
        playsInline
        loop
      />
    </div>
  </div>
}

export default function LandingPage() {
  return <div className="landing-page">
    <header className="lp-header"><div className="lp-shell lp-header-inner"><Link to="/" aria-label="Anant Tattva home"><Wordmark /></Link><div className="lp-header-actions flex items-center gap-3"><Link className="lp-login" to="/client-login"><UserRound />Client Login</Link><Link className="lp-login" to="/login"><UserRound />Staff Login</Link></div></div></header>
    <main>
      <section className="lp-hero"><div className="lp-hero-orb orb-left" /><div className="lp-hero-orb orb-right" />
        <div className="lp-shell lp-hero-grid"><div className="lp-hero-copy"><span className="lp-kicker"><Leaf />Built for responsible growth</span><h1>The CRM that turns complex work into <span>clear progress.</span></h1><p>Connect sales, EPR compliance and daily operations in one intelligent workspace — built around the way your team actually works.</p><div className="lp-hero-actions"><Link className="lp-outline-button" to="/login">Login to CRM</Link></div><div className="lp-proof"><span><LockKeyhole />Secure OTP access</span><span><UsersRound />Role-based workflows</span><span><Zap />Real-time visibility</span></div></div><DashboardPreview /></div>
        <div className="lp-side-words" aria-hidden="true"><span>People</span><span>Processes</span><span>Planet</span><span>Progress</span></div>
      </section>
      <section id="workspace" className="lp-workspace"><div className="lp-shell"><div className="lp-section-heading"><span>One connected workspace</span><h2>Everything your team needs to move business forward.</h2><p>Less switching, fewer blind spots and a more confident next step for everyone.</p></div>
        <div className="lp-service-grid">{services.map(({ icon: Icon, tone, label, title, copy }) => <article className={`lp-service-card ${tone}`} key={label}><span className="lp-service-icon"><Icon /></span><div><small>{label}</small><h3>{title}</h3><p>{copy}</p><a href="mailto:info@ananttattva.com">Discover more <ArrowRight /></a></div><i aria-hidden="true" /></article>)}</div>
        <div className="lp-metrics"><article><span><UsersRound /></span><b>500+<small>Teams empowered</small></b></article><article><span><Zap /></span><b>2x<small>Faster compliance</small></b></article><article><span><ShieldCheck /></span><b>99.9%<small>Reliable &amp; secure</small></b></article><article><span><Building2 /></span><b><small>Trusted by leading organisations<br />across India</small></b></article></div>
      </div></section>
      <section className="lp-partners"><div className="lp-section-heading"><span>Trusted partnerships</span><h2>Supporting ambitious teams across India.</h2></div><ClientScroller /></section>
    </main>
    <footer className="lp-footer"><div className="lp-shell lp-footer-main"><div className="lp-footer-brand"><Wordmark inverse /><p>Business CRM</p></div><p className="lp-footer-line">Smarter operations for a more responsible future.</p><address><b>Mumbai Office</b><span>1st Floor, A/25, Technocraft House, Road No. 3, MIDC,<br />Andheri East, Mumbai - 400093</span></address><address><b>Ahmedabad Office</b><span>World Trade Tower (WTT), Office No. 1112, A Block,<br />11th Floor, Makarba, Ahmedabad - 380051</span></address><div className="lp-socials"><a href="https://www.linkedin.com" aria-label="LinkedIn"><Linkedin /></a><a href="https://www.youtube.com" aria-label="YouTube"><Play /></a><a href="https://twitter.com" aria-label="Twitter"><Twitter /></a></div></div><div className="lp-shell lp-footer-bottom"><small>© {new Date().getFullYear()} Anant Tattva Private Limited. All rights reserved.</small><nav><a href="mailto:info@ananttattva.com">Privacy Policy</a><a href="mailto:info@ananttattva.com">Terms of Use</a><a href="mailto:info@ananttattva.com">Contact Us</a></nav></div></footer>
  </div>
}
