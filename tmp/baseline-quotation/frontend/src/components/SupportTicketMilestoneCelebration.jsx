import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Award, PartyPopper, Trophy, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import api, { API_ENDPOINTS, hasStoredAuthToken } from '../services/api'

const MILESTONE_KEY = 'support_tickets_100_v1'
const DURATION_MS = 15000
const claimPromises = new Map()

function currentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    return String(user.id || user._id || user.email || 'user')
  } catch {
    return 'user'
  }
}

function localSeenKey() {
  return `crm_milestone_${MILESTONE_KEY}_${currentUserId()}`
}

async function claimMilestoneOnce() {
  const userKey = currentUserId()
  if (!claimPromises.has(userKey)) {
    const request = api.post(API_ENDPOINTS.auth.claimMilestone(MILESTONE_KEY))
      .then(({ data }) => data)
      .catch((error) => {
        claimPromises.delete(userKey)
        throw error
      })
    claimPromises.set(userKey, request)
  }
  return claimPromises.get(userKey)
}

function CelebrationCanvas({ reducedMotion, onComplete }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (reducedMotion) {
      const timer = window.setTimeout(onComplete, 5000)
      return () => window.clearTimeout(timer)
    }

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return undefined
    const colors = ['#f59e0b', '#f97316', '#fbbf24', '#fff7d6', '#0f8b78']
    const particles = []
    let frameId
    let stopped = false
    let lastBurst = -1
    const startedAt = performance.now()

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(window.innerWidth * ratio)
      canvas.height = Math.floor(window.innerHeight * ratio)
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const burst = (originX, originY, amount, corner = false) => {
      for (let index = 0; index < amount; index += 1) {
        const angle = corner
          ? (originX < window.innerWidth / 2 ? -Math.PI / 2 + Math.random() * 1.05 : -Math.PI / 2 - Math.random() * 1.05)
          : Math.random() * Math.PI * 2
        const speed = 3.5 + Math.random() * 8
        particles.push({
          x: originX, y: originY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          gravity: 0.075 + Math.random() * 0.055, drag: 0.991, rotation: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.22, size: 3 + Math.random() * 6,
          color: colors[Math.floor(Math.random() * colors.length)], life: 1,
          decay: 0.0035 + Math.random() * 0.003, sparkle: Math.random() > 0.78
        })
      }
    }

    resize()
    burst(0, window.innerHeight, 95, true)
    burst(window.innerWidth, window.innerHeight, 95, true)
    window.addEventListener('resize', resize, { passive: true })

    const draw = (now) => {
      const elapsed = now - startedAt
      if (elapsed >= DURATION_MS || stopped) {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight)
        onComplete()
        return
      }
      const burstIndex = Math.floor((elapsed - 2000) / 700)
      if (elapsed >= 2000 && elapsed < 5000 && burstIndex !== lastBurst) {
        lastBurst = burstIndex
        burst(window.innerWidth * (0.15 + Math.random() * 0.7), window.innerHeight * (0.18 + Math.random() * 0.42), 34)
      }
      if (elapsed >= 5000 && elapsed < 9000 && particles.length < 170 && Math.random() > 0.78) {
        burst(Math.random() * window.innerWidth, -10, 3)
      }
      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const finalFade = elapsed > 12000 ? Math.max(0, 1 - (elapsed - 12000) / 3000) : 1
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index]
        particle.vx *= particle.drag
        particle.vy = particle.vy * particle.drag + particle.gravity
        particle.x += particle.vx
        particle.y += particle.vy
        particle.rotation += particle.spin
        particle.life -= particle.decay
        if (particle.life <= 0 || particle.y > window.innerHeight + 30) {
          particles.splice(index, 1)
          continue
        }
        context.save()
        context.globalAlpha = particle.life * finalFade
        context.translate(particle.x, particle.y)
        context.rotate(particle.rotation)
        context.fillStyle = particle.color
        if (particle.sparkle) {
          context.shadowBlur = 12
          context.shadowColor = particle.color
          context.fillRect(-1, -particle.size, 2, particle.size * 2)
          context.fillRect(-particle.size, -1, particle.size * 2, 2)
        } else {
          context.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.66)
        }
        context.restore()
      }
      frameId = requestAnimationFrame(draw)
    }
    frameId = requestAnimationFrame(draw)
    return () => {
      stopped = true
      cancelAnimationFrame(frameId)
      particles.length = 0
      context.clearRect(0, 0, canvas.width, canvas.height)
      window.removeEventListener('resize', resize)
    }
  }, [onComplete, reducedMotion])

  return reducedMotion ? null : <canvas ref={canvasRef} className="milestone-canvas" aria-hidden="true" />
}

function MilestoneModal({ open, onClose }) {
  const closeRef = useRef(null)
  const previousFocus = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    previousFocus.current = document.activeElement
    closeRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const focusable = Array.from(document.querySelectorAll('.milestone-modal button:not([disabled])'))
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus.current?.focus?.()
    }
  }, [onClose, open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="milestone-modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
          <motion.section className="milestone-modal" role="dialog" aria-modal="true" aria-labelledby="milestone-modal-title" initial={{ opacity: 0, y: 30, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.97 }} transition={{ type: 'spring', stiffness: 240, damping: 24 }}>
            <button ref={closeRef} type="button" className="milestone-close" onClick={onClose} aria-label="Close milestone celebration"><X size={20} /></button>
            <div className="milestone-modal-sparkles" aria-hidden="true"><i /><i /><i /><i /><i /></div>
            <motion.div className="milestone-trophy" animate={{ rotate: [0, -5, 5, 0], y: [0, -4, 0] }} transition={{ duration: 3, repeat: Infinity }}><Trophy size={34} /></motion.div>
            <div className="milestone-brand">ANANTTATTVA</div>
            <div className="milestone-modal-number">100</div>
            <div className="milestone-modal-label">SUPPORT TICKETS</div>
            <h2 id="milestone-modal-title">🎉 A Milestone of 100 Support Tickets!</h2>
            <div className="milestone-message">
              <p>Thank you for your valuable <strong>queries, suggestions, and feedback</strong>.</p>
              <p>We have now reached <strong>100 Support Tickets</strong>, and we hope we have been able to effectively resolve each of your queries and provide the support you expected.</p>
              <p>Your feedback and suggestions play an important role in helping us continuously improve our system.</p>
              <p>We look forward to receiving more of your <strong>valuable suggestions and ideas</strong> as we continue to enhance and develop the system further.</p>
              <p><strong>Thank you for your continued support and contribution! 🙌</strong></p>
              <p className="milestone-signature"><strong>– Team ANANTTATTVA</strong></p>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function SupportTicketMilestoneCelebration() {
  const location = useLocation()
  const reducedMotion = useReducedMotion()
  const [active, setActive] = useState(false)
  const [toastOpen, setToastOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const completeAnimation = React.useCallback(() => setActive(false), [])

  useEffect(() => {
    if (!hasStoredAuthToken()) return undefined
    const storageKey = localSeenKey()
    if (localStorage.getItem(storageKey) === 'seen') return undefined
    let cancelled = false
    claimMilestoneOnce().then((result) => {
      if (cancelled || !result?.claimed) return
      localStorage.setItem(storageKey, 'seen')
      setActive(true)
      setToastOpen(true)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [location.pathname])

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === localSeenKey() && event.newValue === 'seen') setActive(false)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  return (
    <>
      <AnimatePresence>
        {active && (
          <motion.div className="milestone-celebration-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden="true">
            <CelebrationCanvas reducedMotion={reducedMotion} onComplete={completeAnimation} />
            <motion.div className="milestone-stage" initial={{ opacity: 0, scale: 0.72 }} animate={reducedMotion ? { opacity: 1, scale: 1 } : { opacity: [0, 0, 1, 1, 0, 0], scale: [.72, .72, 1, 1, 1.04, 1.04] }} exit={{ opacity: 0, scale: 1.06 }} transition={reducedMotion ? { duration: 0 } : { duration: 15, times: [0, .13, .2, .58, .72, 1], ease: 'easeInOut' }}>
              <div className="milestone-stage-glow" />
              <Award className="milestone-stage-award" size={42} />
              <div className="milestone-stage-number">100</div>
              <div className="milestone-stage-label">Support Tickets Milestone</div>
              <motion.div className="milestone-stage-thanks" initial={{ opacity: 0, y: 10 }} animate={reducedMotion ? { opacity: 1, y: 0 } : { opacity: [0, 0, 1, 1, 0], y: [10, 10, 0, 0, -6] }} transition={reducedMotion ? { delay: .2 } : { duration: 15, times: [0, .33, .38, .58, .7] }}>Thank You for Your Support! 🎉</motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toastOpen && (
          <motion.aside className="milestone-toast" initial={{ opacity: 0, x: 80 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 45 }} transition={{ type: 'spring', stiffness: 280, damping: 27 }} aria-label="Support tickets milestone notification">
            <button type="button" className="milestone-toast-close" onClick={() => setToastOpen(false)} aria-label="Close milestone notification"><X size={17} /></button>
            <div className="milestone-toast-icon"><PartyPopper size={23} /></div>
            <div className="milestone-toast-copy">
              <h2>🎉 A Milestone of 100 Support Tickets!</h2>
              <p>Thank you for your valuable queries, suggestions, and feedback. Together, we have reached an important milestone!</p>
              <button type="button" onClick={() => setModalOpen(true)}>View Celebration</button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <MilestoneModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}
