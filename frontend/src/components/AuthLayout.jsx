import React, { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { Factory, Leaf, Recycle, ShieldCheck, Sparkles, Sprout, Waves, Wind } from 'lucide-react'
import { brand } from '../constants/brand'

export default function AuthLayout({ eyebrow, title, subtitle, children }) {
  const panelRef = useRef(null)
  const visualRef = useRef(null)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const context = gsap.context(() => {
      if (reducedMotion) return
      gsap.fromTo(panelRef.current, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out' })
      gsap.fromTo(visualRef.current, { scale: 0.97, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.9, ease: 'power3.out' })
      gsap.to(visualRef.current?.querySelectorAll('.eco-float'), {
        y: -12,
        duration: 2.8,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        stagger: 0.18
      })
    })
    return () => context.revert()
  }, [])

  return (
    <main className="auth-page min-h-[100dvh] overflow-hidden bg-[#f7faf8] text-slate-950">
      <div className="auth-page-grid grid min-h-[100dvh] lg:grid-cols-[1.08fr_0.92fr]">
        <section ref={visualRef} className="relative hidden min-h-0 overflow-hidden bg-[#f5fbf8] px-8 py-6 lg:block">
          <div className="relative z-10 flex h-full flex-col">
            <div className="flex items-center gap-5">
              <div className="grid h-24 w-40 place-items-center rounded-3xl border border-emerald-100 bg-white px-4 py-2 shadow-xl shadow-emerald-900/10">
                <img src={brand.logoUrl} alt="Anant Tattva" className="h-full w-full object-contain" />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Anant Tattva</p>
                <p className="text-2xl font-black text-slate-950">{brand.name}</p>
              </div>
            </div>

            <div className="mt-7 max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-emerald-700 shadow-sm">
                <Sparkles className="h-4 w-4 text-amber-500" />
                EPR Operations CRM
              </p>
              <h2 className="mt-5 text-[clamp(2rem,4.1vh,3.75rem)] font-black leading-[1.04] text-slate-950">
                Smarter waste, cleaner work, faster teams.
              </h2>
              <p className="mt-4 max-w-xl text-[clamp(.95rem,1.8vh,1.125rem)] font-semibold leading-7 text-slate-600">
                Manage users, sales, compliance and daily action queues from one secure command center.
              </p>
            </div>

            <div className="relative mt-auto h-[43vh] min-h-[300px] max-h-[440px]">
              <div className="absolute inset-x-[-10%] bottom-[-52%] h-[86%] rounded-[100%_100%_0_0] bg-[#7bc6b8] shadow-[inset_0_34px_80px_rgba(255,255,255,0.34)]" />
              <div className="absolute inset-x-[1%] bottom-[-47%] h-[72%] rounded-[100%_100%_0_0] bg-[#8abf63] opacity-90" />
              <div className="absolute bottom-[16%] left-[9%] h-16 w-44 rounded-full bg-[#4c956c]/70 blur-sm" />
              <div className="absolute bottom-[26%] right-[7%] h-14 w-52 rounded-full bg-[#2f8fbc]/45 blur-sm" />

              <EcoBadge className="left-[2%] top-[12%]" icon={Factory} label="Waste" tone="bg-orange-100 text-orange-700" size="lg" />
              <EcoBadge className="left-[27%] top-[2%]" icon={Sprout} label="Growth" tone="bg-lime-100 text-lime-700" />
              <EcoBadge className="left-[47%] top-[34%]" icon={Wind} label="Air" tone="bg-slate-100 text-slate-500" />
              <EcoBadge className="right-[14%] top-[14%]" icon={Waves} label="Water" tone="bg-sky-100 text-sky-700" size="lg" />
              <EcoBadge className="left-[18%] top-[48%]" icon={Recycle} label="Recycle" tone="bg-cyan-100 text-cyan-700" />

            </div>
          </div>
          <div className="absolute -left-24 top-24 h-64 w-64 rounded-full bg-emerald-200/40 blur-3xl" />
          <div className="absolute -right-24 bottom-16 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />
        </section>

        <section className="relative flex items-center px-5 py-6 sm:px-10 lg:min-h-0 lg:px-14 lg:py-5">
          <div ref={panelRef} className="mx-auto w-full max-w-[560px] rounded-[28px] border border-white bg-white/85 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur sm:p-8">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="grid h-14 w-24 place-items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <img src={brand.logoUrl} alt="Anant Tattva" className="h-full w-full object-contain" />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Anant Tattva</p>
                <p className="text-2xl font-black text-slate-950">{brand.name}</p>
              </div>
            </div>

            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-black text-emerald-700">
              <ShieldCheck className="h-4 w-4" />
              {eyebrow}
            </div>
            <h1 className="text-4xl font-black leading-[1.04] text-slate-950 sm:text-5xl">{title}</h1>
            <p className="mt-4 text-base font-semibold leading-7 text-slate-600">{subtitle}</p>
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}

function EcoBadge({ className, icon: Icon, label, tone, size = 'md' }) {
  const dimensions = size === 'lg' ? 'h-44 w-44' : 'h-36 w-36'

  return (
    <div className={`eco-float absolute ${className}`}>
      <div className={`${dimensions} grid place-items-center rounded-full border-4 border-white/80 ${tone} shadow-2xl shadow-slate-900/12`}>
        <div className="text-center">
          <Icon className="mx-auto h-16 w-16" strokeWidth={1.8} />
          <p className="mt-2 text-xs font-black uppercase tracking-[0.14em]">{label}</p>
        </div>
      </div>
    </div>
  )
}
