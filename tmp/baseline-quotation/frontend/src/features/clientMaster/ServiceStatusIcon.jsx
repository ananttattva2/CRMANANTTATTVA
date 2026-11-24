import React from 'react'
import { Check, X } from 'lucide-react'

export default function ServiceStatusIcon({ taken }) {
  const label = taken ? 'Closed PO service' : 'No closed PO for this service'
  const Icon = taken ? Check : X
  return <span role="img" aria-label={label} title={label} className={`inline-flex rounded-full p-1.5 ${taken ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-50 text-rose-500'}`}><Icon size={17} strokeWidth={2.5} aria-hidden="true" /></span>
}
