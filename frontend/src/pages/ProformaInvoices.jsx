import { exportWithReason } from '../utils/dataExport.mjs'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Download, Eye, FileCheck2, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildInvoicePdf } from '../utils/proformaPdf'
import DashboardShell from '../components/dashboard/DashboardShell'
import InvoiceEmailDialog from '../components/InvoiceEmailDialog'
import api, { readApiError, storeSessionUser } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { periodDisplay } from '../utils/servicePeriod'
import { formatDisplayDate } from '../utils/dateFormat'

const blankLead = { referredBy: '', salutation: '', contactPerson: '', designation: '', mobileNo1: '', mobileNo2: '', companyName: '', addressLine1: '', addressLine2: '', addressLine3: '', state: '', city: '', pinCode: '', gstNumber: '' }
const blankItem = { serviceCategory: '', servicesForYear: '', eprCategory: '', piboParent: '', piboCategory: '', unit: '1', basicAmount: '', financialYear: '', validityPeriod: '', annualReturnYears: [], servicesOffered: '', applicableService: '', serviceStartDate: '', serviceEndDate: '', periodUnit: 'annual', transitionPeriod: 'No' }
const blankForm = { paymentPercentage: 100, paymentStage: 'advance', invoiceDetails: {}, quotationId: '', quotationNumber: '', poNumber: '', leadId: '', leadCode: '', leadDetails: { ...blankLead }, invoiceDate: new Date().toISOString().slice(0, 10), validUntil: '', pricingMode: '', combinedBasicAmount: '', items: [{ ...blankItem }], poYearCount: 0, poYearRows: [], terms: [''], scopeOfWork: [''], status: 'issued' }
const firstDistinctPoNumber = (rows = [], quotationNumber = '') => {
  const quotationKey = String(quotationNumber || '').trim().toUpperCase()
  const row = rows.find((candidate) => {
    const poNumber = String(candidate?.poNumber || candidate?.poNo || '').trim()
    return poNumber && poNumber.toUpperCase() !== quotationKey
  })
  return String(row?.poNumber || row?.poNo || '').trim()
}
const leadFields = [['referredBy', 'Referred By'], ['salutation', 'Salutation'], ['contactPerson', 'Contact Person'], ['designation', 'Designation'], ['mobileNo1', 'Mobile No. 1'], ['mobileNo2', 'Mobile No. 2'], ['companyName', 'Company Name'], ['addressLine1', 'Address Line 1'], ['addressLine2', 'Address Line 2'], ['addressLine3', 'Address Line 3'], ['state', 'State'], ['city', 'City'], ['pinCode', 'Pincode'], ['gstNumber', 'GST Number']]

function amount(items = []) { return items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0) }
function invoiceTotal(row = {}) { const full = row.pricingMode === 'combined' ? (Number(row.combinedBasicAmount) || 0) : amount(row.items); return Math.round(full * (row.paymentPercentage ?? 100)) / 100 }
function gstAmount(row = {}) { const subtotal = invoiceTotal(row); return Number.isFinite(Number(row.gstAmount)) && Number(row.gstAmount) > 0 ? Number(row.gstAmount) : Math.round(subtotal * 18) / 100 }
function totalWithGst(row = {}) { return invoiceTotal(row) + gstAmount(row) }
function money(value) { return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` }
function displayDate(value) { return formatDisplayDate(value) }
const EPR_DATA_YEAR_CATEGORIES = new Set(['EPR - Plastic Waste', 'EPR - E-Waste', 'EPR - Battery Waste', 'EPR - Paper Waste', 'EPR - Water Waste', 'EPR - C&D Waste', 'EPR - Tyre Waste', 'EPR - Used Oil Waste', 'EPR - End of Life Vehicles', 'EPR - Non Ferrous'].map((value) => value.toLowerCase()))
function needsEprData(item = {}) { return EPR_DATA_YEAR_CATEGORIES.has(String(item.eprCategory || item.serviceCategory || '').trim().toLowerCase()) }
function eprOrServicePeriod(item = {}) { return periodDisplay(item.servicePeriod, item.periodUnit) }
function selectPeriodLabel(unit = 'annual') { return String(unit || 'annual').trim().toLowerCase() === 'days' ? 'Days' : String(unit || 'annual').trim().toLowerCase() === 'months' ? 'Month' : 'Annual' }
function normalizeLeadContextValue(value) { return String(value || '').trim().toLowerCase() }
function matchesLeadContext(row = {}, context = {}) {
  if (!context) return true
  const companyName = row.companyName || row.leadDetails?.companyName || ''
  const rowLeadId = normalizeLeadContextValue(row.leadId)
  const rowLeadCode = normalizeLeadContextValue(row.leadCode)
  const rowCompany = normalizeLeadContextValue(companyName)
  const contextLeadId = normalizeLeadContextValue(context.leadId)
  const contextLeadCode = normalizeLeadContextValue(context.leadCode)
  const contextCompany = normalizeLeadContextValue(context.clientName || context.company)
  return Boolean(
    (contextLeadId && rowLeadId && contextLeadId === rowLeadId)
    || (contextLeadCode && rowLeadCode && contextLeadCode === rowLeadCode)
    || (contextCompany && rowCompany && contextCompany === rowCompany)
  )
}
function buildFormFromLeadContext(context = {}) {
  return {
    ...blankForm,
    leadId: context.leadId || '',
    leadCode: context.leadCode || '',
    leadDetails: {
      ...blankLead,
      referredBy: context.referredBy || '',
      salutation: context.salutation || '',
      contactPerson: context.contactPerson || '',
      designation: context.designation || '',
      mobileNo1: context.mobileNo1 || '',
      mobileNo2: context.mobileNo2 || '',
      companyName: context.clientName || context.company || '',
      addressLine1: context.addressLine1 || '',
      addressLine2: context.addressLine2 || '',
      addressLine3: context.addressLine3 || '',
      state: context.state || '',
      city: context.city || '',
      pinCode: context.pinCode || '',
      gstNumber: context.gstNumber || ''
    },
    items: [{ ...blankItem }]
  }
}

function QuotationPicker({ value, quotations, onChange }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = quotations.find((row) => String(row._id || row.id) === String(value))
  const filtered = quotations.filter((row) => `${row.quotationNumber} ${row.leadDetails?.companyName || row.companyName || ''}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="relative"><button type="button" onClick={() => setOpen((current) => !current)} className={`flex h-14 w-full items-center justify-between gap-3 rounded-2xl border bg-white px-4 text-left shadow-sm transition ${open ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-slate-200 hover:border-emerald-300'}`}><span className="min-w-0"><small className="block text-[10px] font-black uppercase tracking-wider text-emerald-600">{selected ? 'Selected quotation' : 'Create mode'}</small><strong className="block truncate text-sm text-slate-900">{selected ? `${selected.quotationNumber} · ${selected.leadDetails?.companyName || selected.companyName}` : 'Select a quotation'}</strong></span><ChevronDown className={`h-5 w-5 shrink-0 text-emerald-700 transition ${open ? 'rotate-180' : ''}`} /></button>{open && <><button type="button" aria-label="Close quotation list" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" /><div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-[0_20px_55px_rgba(15,93,70,.2)]"><label className="m-3 flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3"><Search className="h-4 w-4 text-emerald-600" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quotation or company..." className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" /></label><div className="max-h-80 overflow-y-auto p-2 pt-0"><button type="button" onClick={() => { onChange(''); setOpen(false); setSearch('') }} className="mb-1 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left font-black text-emerald-700 hover:bg-emerald-50"><span>Select a quotation</span><Plus className="h-4 w-4" /></button>{filtered.map((quote) => <button type="button" key={quote._id || quote.id} onClick={() => { onChange(quote._id || quote.id); setOpen(false); setSearch('') }} className={`mb-1 grid w-full grid-cols-[1fr_auto] gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-emerald-50 ${String(value) === String(quote._id || quote.id) ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''}`}><span className="min-w-0"><strong className="block text-sm text-slate-900">{quote.quotationNumber}</strong><small className="block truncate font-bold text-slate-500">{quote.leadDetails?.companyName || quote.companyName || 'Unnamed company'}</small></span><span className="self-center text-xs font-black text-orange-600">{money(quote.grandTotal)}</span></button>)}{!filtered.length && <p className="p-8 text-center text-sm font-bold text-slate-400">No matching quotation found.</p>}</div></div></>}</div>
}

function ProformaDetail({ row, onClose, onEdit, onDownload, downloadError }) {
  const [url, setUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  useEffect(() => {
    setUrl('')
    setPreviewError('')
    let next
    try {
      const blob = buildInvoicePdf(row).output('blob')
      if (!blob.size) throw new Error('Generated PDF is empty.')
      next = URL.createObjectURL(blob)
      setUrl(next)
    } catch (error) {
      console.error('Unable to prepare Proforma Invoice preview.', error)
      setPreviewError('Unable to prepare the PDF preview. Please try again or use Download PDF.')
    }
    return () => { if (next) URL.revokeObjectURL(next) }
  }, [row])
  if (!row) return null
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"><div className="flex h-[94vh] w-full max-w-5xl flex-col rounded-2xl bg-white p-4"><header className="mb-3 flex items-center justify-between gap-3"><strong>{row.proformaNumber} · Proforma Invoice</strong><div className="flex gap-3"><button type="button" onClick={() => onEdit(row)}>Edit</button><button type="button" onClick={() => onDownload(row)} className="rounded-lg bg-emerald-700 px-4 py-2 text-white">Download PDF</button><button type="button" aria-label="Close preview" onClick={onClose}><X /></button></div></header>{(previewError || downloadError) && <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{previewError || downloadError}</p>}{!url && !previewError && <p role="status" className="grid min-h-0 flex-1 place-items-center text-sm font-semibold text-slate-500">Preparing PDF preview…</p>}{url && <iframe key={url} title="Proforma Invoice PDF preview" src={url} onLoad={() => setPreviewError('')} onError={() => setPreviewError('The PDF preview could not be displayed. Please use Download PDF.')} className="min-h-0 w-full flex-1 border-0" />}</div></div>
}

export default function ProformaInvoices() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('user') || '{}') } catch { return {} } })
  const [quotations, setQuotations] = useState([])
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [detailRow, setDetailRow] = useState(null)
  const [emailInvoice, setEmailInvoice] = useState(null)
  const [downloadError, setDownloadError] = useState('')
  const poLookupRequest = useRef(0)
  const total = useMemo(() => form.pricingMode === 'combined' ? (Number(form.combinedBasicAmount) || 0) : amount(form.items), [form.combinedBasicAmount, form.items, form.pricingMode])
  const selectedQuote = useMemo(() => form.quotationId ? (quotations.find((q) => String(q._id || q.id) === String(form.quotationId)) || null) : null, [form.quotationId, quotations])
  const quoteItems = selectedQuote?.items || []
  const quoteServiceCategories = useMemo(() => [...new Set((quoteItems).map((i) => i.serviceCategory).filter(Boolean))], [quoteItems])

  function remainingPercentage(row) {
    const related = rows.filter(other => other.quotationId === row.quotationId && other.status !== 'cancelled');
    const billed = Math.max(0, ...(row.items || []).map(item => related.filter(other => other.items?.some(candidate => item.sourceItemIndex != null ? candidate.sourceItemIndex === item.sourceItemIndex : candidate.serviceCategory === item.serviceCategory && candidate.piboCategory === item.piboCategory)).reduce((sum, other) => sum + (other.paymentPercentage ?? 100), 0)));
    return Math.max(0, Math.round((100 - billed) * 100) / 100);
  }

  async function load() {
    setLoading(true); setError('')
    try {
      const [me, quotes, invoices] = await Promise.all([
        api.get(API_ENDPOINTS.auth.me), api.get(API_ENDPOINTS.quotations.list), api.get(API_ENDPOINTS.proformaInvoices.list)
      ])
      setUser(storeSessionUser(me.data.user || user)); setQuotations(quotes.data.quotations || []); setRows(invoices.data.proformaInvoices || [])
    } catch (err) { setError(readApiError(err, 'Unable to load Proforma Invoices.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const leadContext = location.state?.leadContext
    const leadAction = String(location.state?.leadAction || '').trim().toLowerCase()
    if (!leadContext || !leadAction || loading) return

    if (leadAction === 'revise') {
      const invoice = [...rows]
        .filter((row) => matchesLeadContext(row, leadContext))
        .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0]
      if (invoice) {
        edit(invoice)
        setNotice(`Opened ${invoice.proformaNumber || 'the latest Proforma Invoice'} for revision.`)
      } else {
        const quote = [...quotations]
          .filter((row) => matchesLeadContext(row, leadContext))
          .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0]
        if (quote) {
          selectQuotation(quote._id || quote.id)
          setNotice('No saved Proforma Invoice found for this lead. Latest quotation loaded so you can create one.')
        } else {
          setForm(buildFormFromLeadContext(leadContext))
          setEditingId('')
          setNotice('No saved Proforma Invoice found for this lead. You can create a new one.')
          setError('')
        }
      }
      navigate(location.pathname, { replace: true, state: {} })
      return
    }

    const quote = [...quotations]
      .filter((row) => matchesLeadContext(row, leadContext))
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0]
    if (quote) {
      selectQuotation(quote._id || quote.id)
      setNotice('Latest quotation loaded for this lead. Add PO Number and verify before saving.')
    } else {
      setForm(buildFormFromLeadContext(leadContext))
      setEditingId('')
      setNotice('Lead details loaded. Select a quotation or continue manually.')
      setError('')
    }
    navigate(location.pathname, { replace: true, state: {} })
  }, [loading, location.pathname, location.state, navigate, quotations, rows])

  async function selectQuotation(id) {
    const requestId = ++poLookupRequest.current
    const quote = quotations.find((row) => String(row._id || row.id) === String(id))
    if (!quote) { setForm({ ...blankForm, leadDetails: { ...blankLead }, items: [{ ...blankItem }], terms: [''] }); return }
    let eligible, poRows
    try { const response = await api.get(`${API_ENDPOINTS.proformaInvoices.list}/eligible-quotation/${id}`); eligible = response.data.items || []; poRows = response.data.poYearRows || [] }
    catch (err) { if (requestId === poLookupRequest.current) setError(readApiError(err, 'Unable to load PO-closed services.')); return }
    if (requestId !== poLookupRequest.current) return
    setForm({
      ...blankForm,
      quotationId: quote._id || quote.id, quotationNumber: quote.quotationNumber || '', poNumber: firstDistinctPoNumber(poRows, quote.quotationNumber),
      leadId: quote.leadId || '', leadCode: quote.leadCode || '', leadDetails: { ...blankLead, ...(quote.leadDetails || {}) },
      invoiceDate: new Date().toISOString().slice(0, 10), validUntil: quote.validUntil || '',
      pricingMode: quote.pricingMode || 'individual', combinedBasicAmount: quote.pricingMode === 'combined' && eligible.length === quote.items?.length ? (quote.combinedBasicAmount || quote.grandTotal || '') : '',
      items: eligible.map((item) => ({ ...blankItem, ...item })),
      poYearCount: poRows.length,
      poYearRows: poRows,
      terms: (quote.terms || []).length ? [...quote.terms] : [''], scopeOfWork: (quote.scopeOfWork || []).length ? [...quote.scopeOfWork] : [''], status: 'issued'
    }); setEditingId(''); setNotice(`${eligible.length} PO-uploaded, closed services loaded. Open services are excluded.`); setError('')
  }
  function setLead(key, value) { setForm((current) => ({ ...current, leadDetails: { ...current.leadDetails, [key]: value } })) }
  function setItem(index, key, value) { setForm((current) => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, [key]: value } : item) })) }
  function addBlankItem() { setForm((c) => ({ ...c, items: [...c.items, { ...blankItem }] })) }
  function addQuoteItem(quoteItemIndex) {
    const quoteItem = quoteItems[quoteItemIndex]
    if (!quoteItem) return
    setForm((c) => ({ ...c, items: [...c.items, { ...blankItem, ...quoteItem }] }))
  }
  function edit(row) {
    const requestId = ++poLookupRequest.current
    const savedPoNumber = firstDistinctPoNumber([{ poNumber: row.poNumber }, ...(row.poYearRows || [])], row.quotationNumber)
    setEditingId(row._id)
    setForm({
      ...blankForm, ...row,
      poNumber: savedPoNumber,
      poYearRows: row.quotationId ? [] : row.poYearRows || [],
      poYearCount: row.quotationId ? 0 : row.poYearCount || 0,
      pricingMode: row.pricingMode || 'individual',
      combinedBasicAmount: row.combinedBasicAmount ?? '',
      invoiceDate: String(row.invoiceDate || '').slice(0, 10),
      leadDetails: { ...blankLead, ...(row.leadDetails || {}) },
      items: row.items?.length ? row.items.map((item) => ({ ...blankItem, ...item, basicAmount: item.basicAmount ?? '' })) : [{ ...blankItem }],
      terms: row.terms?.length ? row.terms : [''],
      scopeOfWork: row.scopeOfWork?.length ? row.scopeOfWork : ['']
    })
    setError('')
    if (row.quotationId) {
      api.get(`${API_ENDPOINTS.proformaInvoices.list}/eligible-quotation/${row.quotationId}`)
        .then((response) => {
          if (requestId !== poLookupRequest.current) return
          const poYearRows = response.data.poYearRows || []
          setForm((current) => ({
            ...current,
            poYearRows,
            poYearCount: poYearRows.length,
            poNumber: current.poNumber || firstDistinctPoNumber(poYearRows, row.quotationNumber)
          }))
        })
        .catch((err) => {
          if (requestId === poLookupRequest.current) setError(readApiError(err, 'Unable to refresh the lead PO number.'))
        })
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function save() {
    if (!form.quotationNumber.trim() || !form.leadDetails.companyName.trim()) { setError('Quotation Number and Company Name are required.'); return }
    const invoicePoNumber = String(form.poNumber || '').trim()
    if (!invoicePoNumber) { setError('Enter the PO Number for this invoice.'); return }
    if (invoicePoNumber.toUpperCase() === String(form.quotationNumber || '').trim().toUpperCase()) { setError('PO Number must be different from the quotation number.'); return }
    if (!(Number(form.paymentPercentage) > 0 && Number(form.paymentPercentage) <= 100)) { setError('Select a payment percentage greater than 0 and up to 100.'); return }
    if (!form.pricingMode) { setError('Select Combined Price or Individual Price.'); return }
    if (!form.items.length || form.items.some((item) => !item.serviceCategory)) { setError('Every item requires Service Category.'); return }
    if (form.pricingMode === 'combined' && !(Number(form.combinedBasicAmount) > 0)) { setError('Enter a valid Combined Basic Amount.'); return }
    if (form.pricingMode === 'individual' && form.items.some((item) => !(Number(item.basicAmount) > 0))) { setError('Every item requires a valid Basic Amount.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const taxable = Math.round(total * Number(form.paymentPercentage)) / 100
      const tax = Math.round(taxable * 18) / 100
      const payload = { ...form, poNumber: invoicePoNumber, poYearRows: (form.poYearRows || []).slice(0, Math.max(0, Number(form.poYearCount) || 0)), items: form.items.map((item) => ({ ...item, basicAmount: item.basicAmount || 0 })), companyName: form.leadDetails.companyName, subtotal: taxable, gstRate: 18, gstAmount: tax, grandTotal: taxable + tax }
      const response = editingId ? await api.put(API_ENDPOINTS.proformaInvoices.detail(editingId), payload) : await api.post(API_ENDPOINTS.proformaInvoices.create, payload)
      setNotice(`${response.data.proformaInvoice?.proformaNumber || 'Proforma Invoice'} saved successfully.`)
      setForm({ ...blankForm, leadDetails: { ...blankLead }, items: [{ ...blankItem }], terms: [''] }); setEditingId(''); await load()
    } catch (err) { setError(readApiError(err, 'Unable to save Proforma Invoice.')) }
    finally { setSaving(false) }
  }

  async function downloadProforma(row) {
    setDownloadError('')
    const filename = `${String(row.proformaNumber || 'proforma-invoice').replace(/[^a-z0-9._-]+/gi, '-')}.pdf`
    try {
      const pdf = buildInvoicePdf(row)
      await exportWithReason(filename, () => pdf.save(filename))
    } catch (err) {
      console.error('Unable to download Proforma Invoice PDF.', err)
      setDownloadError(`Unable to download PDF: ${err instanceof Error ? err.message : 'Please try again.'}`)
    }
  }

  return <DashboardShell currentUser={user}><div className="min-h-screen bg-gradient-to-br from-[#effaf7] via-white to-[#fff7ef] px-3 py-5 sm:px-4"><div className="w-full min-w-0">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><button onClick={() => navigate('/dashboard')} className="grid h-11 w-11 place-items-center rounded-xl border border-emerald-100 bg-white text-orange-600 shadow-sm"><ArrowLeft /></button><div><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-700">Sales & Billing</p><h1 className="text-3xl font-black text-slate-950">Proforma Invoice</h1><p className="text-sm font-semibold text-slate-500">Create invoices for PO-uploaded, closed services.</p></div></div><button onClick={load} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 font-black text-emerald-700"><RefreshCw className="h-4 w-4" /> Refresh</button></header>
    {(error || notice || downloadError) && <div className={`mt-5 rounded-2xl border px-5 py-4 font-bold ${error || downloadError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice || downloadError}</div>}

    <section className="mt-6 overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-[0_20px_60px_rgba(15,93,70,.09)]"><div className="border-b bg-gradient-to-r from-emerald-50 to-orange-50 p-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-700 text-white"><FileCheck2 /></span><div><h2 className="text-xl font-black">{editingId ? 'Edit Proforma Invoice' : 'Create Proforma Invoice'}</h2><p className="text-sm font-semibold text-slate-500">Select a quotation to load its PO and services.</p></div></div></div>
      <div className="p-5"><div className="mt-2 grid gap-4 lg:grid-cols-4"><label className="lg:col-span-2"><span className="mb-2 block text-sm font-black">Select Quotation</span><QuotationPicker value={form.quotationId || ''} quotations={quotations} onChange={selectQuotation} /></label><label className="lg:col-span-2"><span className="mb-2 block text-sm font-black">Quotation Number *</span><input value={form.quotationNumber} readOnly={Boolean(form.quotationId)} onChange={(e) => setForm((c) => ({ ...c, quotationNumber: e.target.value }))} className="h-14 w-full rounded-2xl border px-4 font-black read-only:bg-slate-100" placeholder="AT/26-27/001" /></label><label className="lg:col-span-2"><span className="mb-2 block text-sm font-black">PO Number *</span><input aria-label="PO Number" value={form.poNumber} onChange={(e) => setForm((c) => ({ ...c, poNumber: e.target.value }))} maxLength={120} placeholder="Enter or edit PO number" className="h-12 w-full rounded-xl border px-4 font-bold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /><span className="mt-1 block text-xs font-semibold text-slate-500">Auto-filled from the lead when available. You can edit it here; the saved value appears on the invoice and PDF.</span></label><label><span className="mb-2 block text-sm font-black">Invoice Date</span><input type="date" value={form.invoiceDate} onChange={(e) => setForm((c) => ({ ...c, invoiceDate: e.target.value }))} className="h-12 w-full rounded-xl border px-4 font-bold" /></label><label><span className="mb-2 block text-sm font-black">Valid Until</span><input type="date" value={form.validUntil} onChange={(e) => setForm((c) => ({ ...c, validUntil: e.target.value }))} className="h-12 w-full rounded-xl border px-4 font-bold" /></label></div>
      <h3 className="mb-3 mt-7 text-lg font-black">Client & Quotation Details</h3><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{leadFields.map(([key, label]) => <label key={key}><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span><input value={form.leadDetails[key] || ''} onChange={(e) => setLead(key, e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 font-bold outline-none focus:border-emerald-400" placeholder={`Enter ${label.toLowerCase()}`} /></label>)}</div>

      <div className="mb-3 mt-7 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-black">Invoice Items</h3><p className="text-xs font-bold text-slate-500">{form.pricingMode ? `${form.pricingMode === 'combined' ? 'Combined' : 'Individual'} pricing selected` : 'Choose pricing type first.'}</p></div>{form.pricingMode && <div className="flex flex-wrap items-center gap-2">{form.quotationId && <select value="" onChange={(e) => { if (e.target.value) { addQuoteItem(Number(e.target.value)); e.target.value = '' } }} className="h-10 rounded-xl border border-emerald-200 bg-white px-3 text-sm font-bold text-emerald-700"><option value="">+ Add from Quotation</option>{quoteItems.map((item, idx) => <option key={idx} value={idx}>{item.serviceCategory || `Item ${idx + 1}`}{item.piboCategory ? ` · ${item.piboCategory}` : ''}</option>)}</select>}<button type="button" onClick={addBlankItem} className="inline-flex h-10 items-center gap-1 rounded-xl bg-emerald-700 px-3 text-sm font-black text-white hover:bg-emerald-600"><Plus className="h-4 w-4" /> Add Item</button></div>}</div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2" role="group" aria-label="Invoice pricing type">{[['combined', 'Combined Price', 'One total amount for the selected invoice services.'], ['individual', 'Individual Price', 'Separate amount for every selected invoice service.']].map(([mode, label, description]) => <button key={mode} type="button" aria-pressed={form.pricingMode === mode} onClick={() => setForm(current => ({ ...current, pricingMode: mode }))} className={`rounded-2xl border-2 p-4 text-left ${form.pricingMode === mode ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-100' : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300'}`}><strong className="block">{label}</strong><span className="mt-1 block text-xs font-semibold">{description}</span></button>)}</div>
      {form.pricingMode && <><div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[1420px] text-left text-sm"><thead className="bg-emerald-800 text-white"><tr>{['Business Category', 'Service Category', 'Services Year', 'Select Period', 'Transition Period', 'Applicant Type', 'Sub Applicant Type', 'Qty / Unit', 'Basic Amount', ''].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{!form.items.length && <tr><td colSpan={10} className="p-6 text-center font-semibold text-amber-800">No PO-uploaded, closed services found for this quotation. Use “Add from Quotation” or “Add Item” above to add services manually.</td></tr>}{form.items.map((item, index) => <tr key={index} className="border-b"><td className="p-2"><input value={item.businessCategory || ''} onChange={(e) => setItem(index, 'businessCategory', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold" /></td><td className="p-2"><input list="quote-service-categories" value={item.serviceCategory || ''} onChange={(e) => setItem(index, 'serviceCategory', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold" /></td><td className="p-2"><input value={item.servicesForYear || ''} onChange={(e) => setItem(index, 'servicesForYear', e.target.value)} className="h-10 w-full rounded-lg border px-2" /></td><td className="p-2"><select value={item.periodUnit || 'annual'} onChange={(e) => setItem(index, 'periodUnit', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold"><option value="days">Days</option><option value="months">Month</option><option value="annual">Annual</option></select></td><td className="p-2"><select value={item.transitionPeriod || 'No'} onChange={(e) => setItem(index, 'transitionPeriod', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold"><option value="Yes">Yes</option><option value="No">No</option></select></td><td className="p-2"><input value={item.piboParent || ''} onChange={(e) => setItem(index, 'piboParent', e.target.value)} className="h-10 w-full rounded-lg border px-2" /></td><td className="p-2"><input value={item.piboCategory || ''} onChange={(e) => setItem(index, 'piboCategory', e.target.value)} className="h-10 w-full rounded-lg border px-2" /></td><td className="p-2"><input value={item.unit || ''} onChange={(e) => setItem(index, 'unit', e.target.value)} className="h-10 w-24 rounded-lg border px-2" /></td>{form.pricingMode === 'individual' && <td className="p-2"><input type="number" value={item.basicAmount ?? ''} onChange={(e) => setItem(index, 'basicAmount', e.target.value)} className="h-10 w-36 rounded-lg border px-2 font-black" /></td>}{form.pricingMode === 'combined' && index === 0 && <td rowSpan={form.items.length} className="bg-emerald-50 p-3 align-middle"><label className="text-[10px] font-black uppercase text-emerald-700">Combined Amount</label><input type="number" value={form.combinedBasicAmount ?? ''} onChange={(e) => setForm((c) => ({ ...c, combinedBasicAmount: e.target.value }))} className="mt-2 h-11 w-40 rounded-lg border border-emerald-300 px-3 font-black" placeholder="50000" /></td>}<td className="p-2"><button disabled={form.items.length === 1} onClick={() => setForm((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))} className="grid h-9 w-9 place-items-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table><datalist id="quote-service-categories">{quoteServiceCategories.map((cat) => <option key={cat} value={cat} />)}</datalist></div></>}
      <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex flex-wrap items-end gap-5"><label><span className="mb-2 block text-sm font-black">Select Percentage (%)</span><input type="number" min="0.01" max="100" step="0.01" value={form.paymentPercentage ?? 100} onChange={(e) => setForm(c => ({ ...c, paymentPercentage: e.target.value }))} className="h-11 w-40 rounded-xl border px-3 font-bold" /></label><label><span className="mb-2 block text-sm font-black">Payment</span><select value={form.paymentStage || 'advance'} onChange={(e) => setForm(c => ({ ...c, paymentStage: e.target.value }))} className="h-11 rounded-xl border px-3 font-bold"><option value="advance">First Payment - Advance</option><option value="later">Second Payment - Later</option></select></label></div><p className="mt-4 font-bold">Full service amount: {money(total)}</p><p className="mt-2 font-black">{form.paymentStage === 'later' ? 'Second Payment - Later' : 'First Payment - Advance'} ({form.paymentPercentage || 0}%): {money(Math.round(total * Number(form.paymentPercentage || 0)) / 100)}</p><p className="mt-1 text-sm">Unselected amount: {money(total - Math.round(total * Number(form.paymentPercentage || 0)) / 100)}. Create its invoice later from the saved invoice. GST applies to each payment amount.</p></section>
      <div className="mt-6 grid gap-5 lg:grid-cols-2"><label><span className="mb-2 block text-sm font-black">Terms & Conditions</span><textarea value={form.terms.join('\n')} onChange={(e) => setForm((c) => ({ ...c, terms: e.target.value.split(/\r?\n/) }))} rows={6} className="w-full rounded-2xl border p-4 font-semibold outline-none" placeholder="One term per line" /></label><label><span className="mb-2 block text-sm font-black">Scope of Work</span><textarea value={(form.scopeOfWork || []).join('\n')} onChange={(e) => setForm((c) => ({ ...c, scopeOfWork: e.target.value.split(/\r?\n/) }))} rows={6} className="w-full rounded-2xl border p-4 font-semibold outline-none" placeholder="One scope item per line" /></label></div><div className="mt-5 ml-auto max-w-sm rounded-2xl bg-gradient-to-br from-emerald-800 to-teal-700 p-5 text-white"><span className="text-xs font-black uppercase tracking-wider text-emerald-200">Grand Total</span><strong className="mt-2 block text-3xl">{money(Math.round(total * Number(form.paymentPercentage || 0)) / 100 * 1.18)}</strong><p className="mt-2 text-sm text-emerald-100">Calculated automatically from quantity × basic amount.</p><button disabled={saving} onClick={save} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 font-black shadow-lg transition hover:bg-orange-400 disabled:opacity-50"><Save className="h-5 w-5" /> {saving ? 'Saving…' : editingId ? 'Update Invoice' : 'Save Proforma Invoice'}</button></div></div>
    </section>

    <section className="mt-7 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><header className="flex items-center justify-between border-b p-5"><div><h2 className="text-xl font-black">Saved Proforma Invoices</h2><p className="text-sm font-semibold text-slate-500">{rows.length} records stored in CRM database</p></div></header><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr>{['Proforma No.', 'Quotation No.', 'PO Number', 'Company', 'Date', 'Amount', 'Status', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row._id} className="border-b transition hover:bg-emerald-50/30"><td className="p-4 font-black text-emerald-700">{row.proformaNumber}</td><td className="p-4 font-bold">{row.quotationNumber}</td><td className="p-4 font-bold">{firstDistinctPoNumber([{ poNumber: row.poNumber }, ...(row.poYearRows || [])], row.quotationNumber) || '-'}</td><td className="p-4 font-black">{row.companyName}</td><td className="p-4">{String(row.invoiceDate || '').slice(0, 10)}</td><td className="p-4 font-black">{money(row.grandTotal)}</td><td className="p-4"><span className="rounded-full bg-emerald-50 px-3 py-1 font-black text-emerald-700">{row.status}</span></td><td className="p-4"><div className="flex gap-2"><button title="View details" onClick={() => { setDownloadError(''); setDetailRow(row) }} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50"><Eye className="h-4 w-4" /></button><button title="Download PDF" onClick={() => downloadProforma(row)} className="grid h-9 w-9 place-items-center rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50"><Download className="h-4 w-4" /></button>{remainingPercentage(row) > 0 && row.status !== 'cancelled' && <button onClick={() => { edit({ ...row, paymentPercentage: remainingPercentage(row), paymentStage: 'later', invoiceDate: new Date().toISOString().slice(0, 10) }); setEditingId(''); setNotice('Balance payment loaded. Verify the remaining percentage before saving a new invoice.'); }} className="rounded-lg border border-emerald-200 px-3 py-2 font-black text-emerald-700">Create Balance Invoice</button>}<button onClick={() => edit(row)} className="rounded-lg border border-orange-200 px-3 py-2 font-black text-orange-600 hover:bg-orange-50">Edit</button><button type="button" disabled={row.status === 'cancelled'} onClick={() => setEmailInvoice(row)} className="rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white hover:bg-emerald-800 disabled:opacity-40">Send Email</button></div></td></tr>)}{!rows.length && <tr><td colSpan="8" className="p-12 text-center font-bold text-slate-400">{loading ? 'Loading…' : 'No Proforma Invoices created yet.'}</td></tr>}</tbody></table></div></section>
    {emailInvoice && <InvoiceEmailDialog key={emailInvoice._id} invoice={emailInvoice} onClose={() => setEmailInvoice(null)} onSent={message => { setEmailInvoice(null); setNotice(message) }} />}
    {detailRow && <ProformaDetail row={detailRow} onClose={() => { setDetailRow(null); setDownloadError('') }} onEdit={(row) => { setDetailRow(null); edit(row) }} onDownload={downloadProforma} downloadError={downloadError} />}
  </div></div></DashboardShell>
}
