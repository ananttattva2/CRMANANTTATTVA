import React, { useEffect, useRef, useState } from 'react'
import { ArrowRight, FileCheck2, X } from 'lucide-react'
import api from '../services/api'

export default function ClientApplicantPicker({ row, onClose, onSelect }) {
  const dialog = useRef(null)
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api.get('/clients/discovery/services', { params: { identity: `client:${row.id}` }, signal: controller.signal, timeout: 20000 })
      .then(response => {
        if (controller.signal.aborted) return
        const seen = new Set()
        const records = (response.data.services || []).filter(service => service.clientMasterId && !seen.has(service.clientMasterId) && seen.add(service.clientMasterId))
        setServices(records)
        if (!records.length) setError('No accessible applicant records found for this client.')
      })
      .catch(() => { if (!controller.signal.aborted) setError('Could not load applicant records. Please retry.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [row.id, retry])
  return <dialog ref={dialog} className="client-applicant-picker" aria-labelledby="applicant-picker-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header><div><small>COMPLIANCE REVIEW</small><h2 id="applicant-picker-title">Select applicant</h2><p>{row.clientName || row.companyName}</p></div><button type="button" aria-label="Close applicant selection" onClick={onClose}><X size={20} /></button></header>
    <p className="applicant-picker-hint">Choose the applicant record you want to review.</p>
    {loading ? <p role="status">Loading applicant records…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : <div className="applicant-picker-options">{services.map(service => <button type="button" key={service.clientMasterId} onClick={() => onSelect(service)}><FileCheck2 size={22} /><span><strong>{service.piboCategory || service.applicantType || 'Applicant'}</strong><small>{[service.eprCategory, service.servicesOffered, service.plantUnit].filter(Boolean).join(' · ')}</small><small>{service.leadCode}</small></span><ArrowRight size={18} /></button>)}</div>}
  </dialog>
}
