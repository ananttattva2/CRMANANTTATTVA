import React, { useId } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Check } from 'lucide-react'

export default function FinancialYearTimeline({ sections, selectedYear, onSelect, reducedMotion }) {
  const highlightId = useId()
  function selectTab(index, tabs) {
    const next = (index + sections.length) % sections.length
    onSelect(sections[next].year)
    tabs[next]?.focus()
    tabs[next]?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' })
  }
  return <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white px-4 py-5 shadow-sm sm:px-6"><div role="tablist" aria-label="Service matrix financial year" className="flex min-w-max items-center">
    {sections.map((section, index) => {
      const selected = selectedYear === section.year
      return <React.Fragment key={section.year}>{index > 0 && <motion.span aria-hidden="true" initial={reducedMotion ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: .4, delay: reducedMotion ? 0 : Math.min(index * .08, .4) }} className="h-0.5 w-8 origin-left bg-teal-200 sm:w-12" />}
        <button type="button" role="tab" id={`matrix-year-${section.year}`} aria-selected={selected} aria-controls="overall-year-matrix" tabIndex={selected ? 0 : -1} onClick={() => onSelect(section.year)} onKeyDown={(event) => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const tabs = event.currentTarget.parentElement.querySelectorAll('[role=tab]')
          selectTab(event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : index + (event.key === 'ArrowRight' ? 1 : -1), tabs)
        }} className={`relative flex min-w-44 items-center gap-3 overflow-hidden rounded-2xl border px-4 py-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-600 ${selected ? 'border-teal-700 text-white shadow-md shadow-teal-900/15' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-300 hover:bg-teal-50'}`}>
          {selected && <motion.span layoutId={`fy-highlight-${highlightId}`} transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }} className="absolute inset-0 bg-gradient-to-br from-teal-800 to-teal-600" />}
          <span className={`relative rounded-xl p-2 ${selected ? 'bg-white/15 text-teal-100' : 'bg-white text-teal-700'}`}><CalendarDays size={20} /></span><span className="relative"><span className={`block text-[10px] font-bold uppercase tracking-widest ${selected ? 'text-teal-100' : 'text-slate-400'}`}>Financial year</span><span className="mt-1 block text-base font-black">{section.year}</span><span className={`mt-1 block text-xs ${selected ? 'text-teal-100' : 'text-slate-500'}`}>{section.summary.clients} clients</span></span>{selected && <Check size={15} aria-hidden="true" className="relative ml-1 text-teal-100" />}
        </button>
      </React.Fragment>
    })}
  </div></div>
}
