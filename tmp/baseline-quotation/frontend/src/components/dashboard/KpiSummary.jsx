import React from 'react'

export default function KpiSummary({ metrics }) {
  return (
    <section className="mt-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {metrics.map((metric, index) => {
          const Icon = metric.icon
          return (
            <button
              type="button"
              onClick={metric.onClick}
              disabled={!metric.onClick}
              key={metric.label}
              className={`group relative min-h-[120px] overflow-hidden rounded-2xl border px-5 py-5 text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-sm sm:px-6 ${
                index === 0
                  ? 'border-emerald-600 bg-gradient-to-br from-emerald-700 to-teal-800 text-white shadow-emerald-700/15'
                  : 'border-amber-100 bg-white text-slate-900 hover:border-amber-200'
              } ${metric.active ? 'ring-4 ring-emerald-200' : ''}`}
            >
              <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full transition duration-300 group-hover:scale-125 ${index === 0 ? 'bg-white/10' : 'bg-amber-50'}`} />
              <div className={`absolute bottom-0 left-0 h-1 w-full ${index === 0 ? 'bg-emerald-300/80' : 'bg-amber-400/70'}`} />
              <div className="relative flex h-full items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className={`text-xs font-black uppercase tracking-[0.14em] ${index === 0 ? 'text-emerald-50' : 'text-slate-500'}`}>{metric.label}</p>
                  <p className={`mt-3 text-5xl font-black leading-none ${index === 0 ? 'text-white' : metric.valueClass}`}>{metric.value}</p>
                  <p className={`mt-2 text-sm font-bold ${index === 0 ? 'text-emerald-50/80' : 'text-slate-500'}`}>
                    {metric.note || (index === 0 ? 'Ready for assignment' : 'Needs attention')}
                  </p>
                </div>
                <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl transition duration-300 group-hover:rotate-3 group-hover:scale-110 ${index === 0 ? 'bg-white/15 text-white' : metric.iconClass}`}>
                  <Icon className="h-6 w-6" />
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
