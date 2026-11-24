import React from 'react'
import { LayoutTemplate } from 'lucide-react'
import DashboardShell from '../components/dashboard/DashboardShell'

function readCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    return null
  }
}

export default function Dummey() {
  const currentUser = readCurrentUser()

  return (
    <DashboardShell currentUser={currentUser}>
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-sm">
          <div className="bg-gradient-to-br from-[#0f6655] to-[#16805f] px-6 py-10 text-white sm:px-10">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
              <LayoutTemplate className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="mt-6 text-xs font-black uppercase tracking-[0.3em] text-emerald-100">Placeholder module</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Dummey</h1>
            <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-emerald-50/90">
              This page is ready for the next CRM module or workflow you want to add.
            </p>
          </div>

          <div className="p-6 sm:p-10">
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
              <h2 className="text-xl font-black text-slate-900">Dummey page created successfully</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
                The sidebar link and protected route are connected. Content can be added here whenever the module requirements are finalized.
              </p>
            </div>
          </div>
        </section>
      </div>
    </DashboardShell>
  )
}
