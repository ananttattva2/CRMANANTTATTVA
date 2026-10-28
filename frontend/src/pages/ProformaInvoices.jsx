import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, Download, Eye, FileCheck2, Plus, RefreshCw, Save, Search, Trash2, Upload, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { buildInvoicePdf, invoiceFields } from '../utils/proformaPdf'
import DashboardShell from '../components/dashboard/DashboardShell'
import api, { readApiError, storeSessionUser } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'
import { uploadMedia } from '../services/mediaUpload'
import { periodDisplay } from '../utils/servicePeriod'
import { formatDisplayDate } from '../utils/dateFormat'

const blankLead = { referredBy: '', salutation: '', contactPerson: '', designation: '', mobileNo1: '', mobileNo2: '', companyName: '', addressLine1: '', addressLine2: '', addressLine3: '', state: '', city: '', pinCode: '', gstNumber: '' }
const blankItem = { serviceCategory: '', servicesForYear: '', eprCategory: '', piboParent: '', piboCategory: '', unit: '1', basicAmount: '', financialYear: '', validityPeriod: '', annualReturnYears: [], servicesOffered: '', applicableService: '', serviceStartDate: '', serviceEndDate: '', periodUnit: 'annual', transitionPeriod: 'No' }
const blankPoYearRow = { fy: '', poNumber: '', annualReturnYear: '', quotationNo: '', compliancePoDate: '', compliancePoFile: '', serviceCategory: [], value: '' }
const blankForm = { invoiceDetails: {}, quotationId: '', quotationNumber: '', poNumber: '', leadId: '', leadCode: '', leadDetails: { ...blankLead }, invoiceDate: new Date().toISOString().slice(0, 10), validUntil: '', pricingMode: '', combinedBasicAmount: '', items: [{ ...blankItem }], poYearCount: 1, poYearRows: [{ ...blankPoYearRow }], terms: [''], scopeOfWork: [''], status: 'issued' }
const leadFields = [['referredBy', 'Referred By'], ['salutation', 'Salutation'], ['contactPerson', 'Contact Person'], ['designation', 'Designation'], ['mobileNo1', 'Mobile No. 1'], ['mobileNo2', 'Mobile No. 2'], ['companyName', 'Company Name'], ['addressLine1', 'Address Line 1'], ['addressLine2', 'Address Line 2'], ['addressLine3', 'Address Line 3'], ['state', 'State'], ['city', 'City'], ['pinCode', 'Pincode'], ['gstNumber', 'GST Number']]

function amount(items = []) { return items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0) }
function invoiceTotal(row = {}) { return row.pricingMode === 'combined' ? (Number(row.combinedBasicAmount) || Number(row.subtotal) || Number(row.grandTotal) || 0) : amount(row.items) }
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
  return <div className="relative"><button type="button" onClick={() => setOpen((current) => !current)} className={`flex h-14 w-full items-center justify-between gap-3 rounded-2xl border bg-white px-4 text-left shadow-sm transition ${open ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-slate-200 hover:border-emerald-300'}`}><span className="min-w-0"><small className="block text-[10px] font-black uppercase tracking-wider text-emerald-600">{selected ? 'Selected quotation' : 'Create mode'}</small><strong className="block truncate text-sm text-slate-900">{selected ? `${selected.quotationNumber} · ${selected.leadDetails?.companyName || selected.companyName}` : 'New / Manual Proforma Invoice'}</strong></span><ChevronDown className={`h-5 w-5 shrink-0 text-emerald-700 transition ${open ? 'rotate-180' : ''}`} /></button>{open && <><button type="button" aria-label="Close quotation list" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" /><div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-[0_20px_55px_rgba(15,93,70,.2)]"><label className="m-3 flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3"><Search className="h-4 w-4 text-emerald-600" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quotation or company..." className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" /></label><div className="max-h-80 overflow-y-auto p-2 pt-0"><button type="button" onClick={() => { onChange(''); setOpen(false); setSearch('') }} className="mb-1 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left font-black text-emerald-700 hover:bg-emerald-50"><span>New / Manual Proforma Invoice</span><Plus className="h-4 w-4" /></button>{filtered.map((quote) => <button type="button" key={quote._id || quote.id} onClick={() => { onChange(quote._id || quote.id); setOpen(false); setSearch('') }} className={`mb-1 grid w-full grid-cols-[1fr_auto] gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-emerald-50 ${String(value) === String(quote._id || quote.id) ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''}`}><span className="min-w-0"><strong className="block text-sm text-slate-900">{quote.quotationNumber}</strong><small className="block truncate font-bold text-slate-500">{quote.leadDetails?.companyName || quote.companyName || 'Unnamed company'}</small></span><span className="self-center text-xs font-black text-orange-600">{money(quote.grandTotal)}</span></button>)}{!filtered.length && <p className="p-8 text-center text-sm font-bold text-slate-400">No matching quotation found.</p>}</div></div></>}</div>
}

function PoMappingTable({ form, setForm }) {
  const [openRow, setOpenRow] = useState(null)
  const [uploadingRow, setUploadingRow] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const count = Math.max(0, Number(form.poYearCount) || 0)
  const serviceOptions = [...new Set((form.items || []).map((item) => String(item.serviceCategory || '').trim()).filter(Boolean))]
  const rows = Array.from({ length: count }, (_, index) => ({
    ...blankPoYearRow,
    quotationNo: form.quotationNumber || '',
    ...(form.poYearRows?.[index] || {})
  }))
  const updateRows = (next) => setForm((current) => ({ ...current, poYearRows: next }))
  const updateRow = (index, key, value) => updateRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  const updateCount = (value) => {
    const nextCount = Math.max(0, Math.min(50, Number(value) || 0))
    setForm((current) => ({ ...current, poYearCount: nextCount, poYearRows: Array.from({ length: nextCount }, (_, index) => ({ ...blankPoYearRow, quotationNo: current.quotationNumber || '', ...(current.poYearRows?.[index] || {}) })) }))
  }
  const toggleService = (rowIndex, option) => {
    const selected = rows[rowIndex]?.serviceCategory || []
    updateRow(rowIndex, 'serviceCategory', selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])
  }
  const uploadPoFile = async (rowIndex, file) => {
    if (!file) return
    setUploadingRow(rowIndex); setUploadError('')
    try {
      const uploaded = await uploadMedia(file, 'crm/proforma-invoices/compliance-po')
      updateRow(rowIndex, 'compliancePoFile', uploaded)
    } catch (uploadError) {
      setUploadError(uploadError?.message || 'Unable to upload Compliance PO.')
    } finally { setUploadingRow(null) }
  }
  return <section className="mt-7 overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/70 to-orange-50/50">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-emerald-100 px-5 py-4">
      <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">Compliance PO Mapping</p><h3 className="mt-1 text-lg font-black">Mention No. of Year PO</h3><p className="text-xs font-bold text-slate-500">Fill once here; saved rows auto-fetch in Client Master.</p>{uploadError && <p className="mt-1 text-xs font-black text-red-600">{uploadError}</p>}</div>
      <label className="w-40"><span className="mb-2 block text-[10px] font-black uppercase tracking-wider text-emerald-800">No. of Year PO</span><input type="number" min="0" max="50" value={count || ''} onChange={(event) => updateCount(event.target.value)} className="h-11 w-full rounded-xl border border-emerald-200 bg-white px-3 font-black" /></label>
    </header>
    {count > 0 && <div className="overflow-x-auto bg-white"><table className="w-full min-w-[1200px] text-left text-xs"><thead className="bg-emerald-50 text-[10px] uppercase tracking-wide text-emerald-900"><tr>{['#', 'F.Y', 'Annual Return', 'Quotation No.', 'Compliance PO Date', 'Upload Compliance PO', 'Service Category', 'Value'].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-emerald-50">
      <td className="p-3 font-black text-emerald-700">{index + 1}</td>
      <td className="p-2"><input value={row.fy || ''} onChange={(event) => updateRow(index, 'fy', event.target.value)} placeholder="2024-25" className="h-11 w-28 rounded-xl border px-3 font-bold" /></td>
      <td className="p-2"><input value={row.annualReturnYear || ''} onChange={(event) => updateRow(index, 'annualReturnYear', event.target.value)} placeholder="2024-25" className="h-11 w-32 rounded-xl border px-3 font-bold" /></td>
      <td className="p-2"><input value={row.quotationNo || ''} onChange={(event) => updateRow(index, 'quotationNo', event.target.value)} placeholder="Quotation No." className="h-11 w-36 rounded-xl border px-3 font-bold" /></td>
      <td className="p-2"><input type="date" value={row.compliancePoDate || ''} onChange={(event) => updateRow(index, 'compliancePoDate', event.target.value)} className="h-11 w-40 rounded-xl border px-3 font-bold" /></td>
      <td className="p-2"><label className="flex h-11 w-48 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-3 font-black text-emerald-700"><Upload className="h-4 w-4 shrink-0" /><span className="truncate">{uploadingRow === index ? 'Uploading...' : row.compliancePoFile?.name || row.compliancePoFile || 'Upload PO'}</span><input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" disabled={uploadingRow === index} onChange={(event) => uploadPoFile(index, event.target.files?.[0])} /></label></td>
      <td className="relative p-2"><button type="button" onClick={() => setOpenRow(openRow === index ? null : index)} className="flex h-11 w-56 items-center justify-between rounded-xl border bg-white px-3 font-bold"><span className="truncate">{row.serviceCategory?.length ? `${row.serviceCategory.length} selected` : 'Select service category'}</span><ChevronDown className="h-4 w-4" /></button>{openRow === index && <div className="absolute z-30 mt-1 max-h-48 w-64 overflow-y-auto rounded-xl border bg-white p-2 shadow-xl">{serviceOptions.length ? serviceOptions.map((option) => <label key={option} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 font-bold hover:bg-emerald-50"><input type="checkbox" checked={(row.serviceCategory || []).includes(option)} onChange={() => toggleService(index, option)} /><span>{option}</span></label>) : <p className="p-3 text-slate-400">Add invoice items first.</p>}</div>}<small className="mt-1 block max-w-56 truncate font-bold text-slate-400">{(row.serviceCategory || []).join(', ') || 'No service selected'}</small></td>
      <td className="p-2"><input type="number" value={row.value ?? ''} onChange={(event) => updateRow(index, 'value', event.target.value)} placeholder="0" className="h-11 w-28 rounded-xl border px-3 font-black" /></td>
    </tr>)}</tbody></table></div>}
  </section>
}

function ProformaPoYearTable({ form, setForm }) {
  const [openRow, setOpenRow] = useState(null)
  const [uploadingRow, setUploadingRow] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const count = Math.max(0, Number(form.poYearCount) || 0)
  const rows = Array.from({ length: count }, (_, index) => ({ ...blankPoYearRow, ...(form.poYearRows?.[index] || {}) }))
  const services = [...new Set((form.items || []).map((item) => String(item.serviceCategory || '').trim()).filter(Boolean))]
  const currentStart = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1
  const financialYears = Array.from({ length: 10 }, (_, index) => { const start = currentStart - 5 + index; return `${start}-${String(start + 1).slice(-2)}` })
  const resize = (nextCount) => setForm((current) => ({
    ...current,
    poYearCount: Math.max(0, Math.min(50, nextCount)),
    poYearRows: Array.from({ length: Math.max(0, Math.min(50, nextCount)) }, (_, index) => ({ ...blankPoYearRow, ...(current.poYearRows?.[index] || {}) }))
  }))
  const updateRow = (rowIndex, key, value) => setForm((current) => ({
    ...current,
    poYearRows: rows.map((row, index) => index === rowIndex ? { ...row, [key]: value } : row)
  }))
  const toggleService = (rowIndex, service) => {
    const selected = rows[rowIndex]?.serviceCategory || []
    updateRow(rowIndex, 'serviceCategory', selected.includes(service) ? selected.filter((item) => item !== service) : [...selected, service])
  }
  const uploadFile = async (rowIndex, file) => {
    if (!file) return
    setUploadingRow(rowIndex); setUploadError('')
    try { updateRow(rowIndex, 'compliancePoFile', await uploadMedia(file, 'crm/proforma-invoices/purchase-orders')) }
    catch (error) { setUploadError(error?.message || 'Unable to upload PO file.') }
    finally { setUploadingRow(null) }
  }

  return <section className="mt-7 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-5"><div><p className="text-[11px] font-black uppercase tracking-[.2em] text-slate-500">PO Received For No Of Year</p><strong className="mt-2 block text-2xl text-slate-950">{count}</strong>{uploadError && <p className="mt-2 text-xs font-black text-red-600">{uploadError}</p>}</div><div className="flex gap-2"><button type="button" onClick={() => resize(count + 1)} disabled={count >= 50} className="rounded-xl bg-[#416c5a] px-5 py-3 text-sm font-black text-white disabled:opacity-40">+ Add Next Year</button><button type="button" onClick={() => resize(count - 1)} disabled={!count} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 disabled:opacity-40">Remove Last Year</button></div></header>
    {count > 0 && <div className="mx-5 mb-5 overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-gradient-to-r from-emerald-50 to-cyan-50 text-[11px] uppercase tracking-[.14em] text-teal-900"><tr>{['Sr. No', 'FY Year', 'PO Number', 'PO Upload', 'Services'].map((heading) => <th key={heading} className="px-5 py-4">{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-slate-100 align-top">
      <td className="p-5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 font-black">{index + 1}</span></td>
      <td className="p-5"><select value={row.fy || ''} onChange={(event) => updateRow(index, 'fy', event.target.value)} className="h-12 min-w-40 rounded-xl border border-slate-200 bg-white px-4 font-black"><option value="">Select FY Year</option>{financialYears.map((fy) => <option key={fy} value={fy}>{fy}</option>)}</select></td>
      <td className="p-5"><input value={row.poNumber || ''} onChange={(event) => updateRow(index, 'poNumber', event.target.value)} placeholder="Enter PO Number" className="h-12 min-w-52 rounded-xl border border-slate-200 px-4 font-bold" /></td>
      <td className="p-5"><label className="flex h-12 w-44 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50 px-4 font-black text-[#416c5a]"><Upload className="h-4 w-4 shrink-0" /><span className="truncate">{uploadingRow === index ? 'Uploading...' : row.compliancePoFile?.name || row.compliancePoFile || 'Choose File'}</span><input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" disabled={uploadingRow === index} onChange={(event) => uploadFile(index, event.target.files?.[0])} /></label></td>
      <td className="relative p-5"><button type="button" onClick={() => setOpenRow(openRow === index ? null : index)} className="flex min-h-12 w-full min-w-[360px] items-center justify-between rounded-xl border border-slate-200 bg-white px-4"><span className="flex flex-wrap gap-2">{row.serviceCategory?.length ? row.serviceCategory.map((service) => <span key={service} className="rounded-lg bg-teal-50 px-3 py-1 text-xs font-black text-[#30737B]">{service}</span>) : <span className="font-bold text-slate-400">Select services</span>}</span><ChevronDown className="h-4 w-4 shrink-0" /></button>{openRow === index && <div className="absolute left-5 right-5 z-30 mt-1 max-h-48 overflow-y-auto rounded-xl border bg-white p-2 shadow-xl">{services.length ? services.map((service) => <label key={service} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 font-bold hover:bg-emerald-50"><input type="checkbox" checked={(row.serviceCategory || []).includes(service)} onChange={() => toggleService(index, service)} />{service}</label>) : <p className="p-3 font-bold text-slate-400">Add invoice items first.</p>}</div>}</td>
    </tr>)}</tbody></table></div>}
  </section>
}

function downloadProforma(row) { buildInvoicePdf(row).save(`${row.proformaNumber || 'proforma-invoice'}.pdf`) }
function ProformaDetail({ row, onClose, onEdit }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!row) return
    const next = URL.createObjectURL(buildInvoicePdf(row).output('blob'))
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [row])
  if (!row) return null
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"><div className="flex h-[94vh] w-full max-w-5xl flex-col rounded-2xl bg-white p-4"><header className="mb-3 flex items-center justify-between gap-3"><strong>{row.proformaNumber} · Proforma Invoice</strong><div className="flex gap-3"><button onClick={() => onEdit(row)}>Edit</button><button onClick={() => downloadProforma(row)} className="rounded-lg bg-emerald-700 px-4 py-2 text-white">Download PDF</button><button aria-label="Close preview" onClick={onClose}><X /></button></div></header>{url && <iframe title="Proforma Invoice PDF preview" src={url} className="min-h-0 w-full flex-1 border-0" />}</div></div>
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
  const total = useMemo(() => form.pricingMode === 'combined' ? (Number(form.combinedBasicAmount) || 0) : amount(form.items), [form.combinedBasicAmount, form.items, form.pricingMode])

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

  function selectQuotation(id) {
    const quote = quotations.find((row) => String(row._id || row.id) === String(id))
    if (!quote) { setForm({ ...blankForm, leadDetails: { ...blankLead }, items: [{ ...blankItem }], terms: [''] }); return }
    setForm({
      quotationId: quote._id || quote.id, quotationNumber: quote.quotationNumber || '', poNumber: '',
      leadId: quote.leadId || '', leadCode: quote.leadCode || '', leadDetails: { ...blankLead, ...(quote.leadDetails || {}) },
      invoiceDate: new Date().toISOString().slice(0, 10), validUntil: quote.validUntil || '',
      pricingMode: quote.pricingMode || 'individual', combinedBasicAmount: quote.pricingMode === 'combined' ? (quote.combinedBasicAmount || quote.grandTotal || '') : '',
      items: (quote.items || []).length ? quote.items.map((item) => ({ ...blankItem, ...item })) : [{ ...blankItem }],
      poYearCount: 1,
      poYearRows: [{ ...blankPoYearRow, quotationNo: quote.quotationNumber || '' }],
      terms: (quote.terms || []).length ? [...quote.terms] : [''], scopeOfWork: (quote.scopeOfWork || []).length ? [...quote.scopeOfWork] : [''], status: 'issued'
    }); setEditingId(''); setNotice('Quotation details auto-fetched. Add PO Number and verify before saving.'); setError('')
  }
  function setLead(key, value) { setForm((current) => ({ ...current, leadDetails: { ...current.leadDetails, [key]: value } })) }
  function setItem(index, key, value) { setForm((current) => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, [key]: value } : item) })) }
  function edit(row) { setEditingId(row._id); setForm({ ...blankForm, ...row, pricingMode: row.pricingMode || 'individual', combinedBasicAmount: row.combinedBasicAmount ?? '', invoiceDate: String(row.invoiceDate || '').slice(0, 10), leadDetails: { ...blankLead, ...(row.leadDetails || {}) }, items: row.items?.length ? row.items.map((item) => ({ ...blankItem, ...item, basicAmount: item.basicAmount ?? '' })) : [{ ...blankItem }], terms: row.terms?.length ? row.terms : [''], scopeOfWork: row.scopeOfWork?.length ? row.scopeOfWork : [''] }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  async function save() {
    if (!form.quotationNumber.trim() || !form.leadDetails.companyName.trim()) { setError('Quotation Number and Company Name are required.'); return }
    if (!form.pricingMode) { setError('Select Combined Price or Individual Price.'); return }
    if (!form.items.length || form.items.some((item) => !item.serviceCategory)) { setError('Every item requires Service Category.'); return }
    if (!form.poYearCount || (form.poYearRows || []).slice(0, form.poYearCount).some((row) => !String(row.fy || '').trim() || !String(row.poNumber || '').trim() || !row.compliancePoFile || !(row.serviceCategory || []).length)) { setError('FY Year, PO Number, PO Upload and Services are required for every PO year.'); return }
    if (form.pricingMode === 'combined' && !(Number(form.combinedBasicAmount) > 0)) { setError('Enter a valid Combined Basic Amount.'); return }
    if (form.pricingMode === 'individual' && form.items.some((item) => !(Number(item.basicAmount) > 0))) { setError('Every item requires a valid Basic Amount.'); return }
    setSaving(true); setError(''); setNotice('')
    try {
      const tax = Math.round(total * 18) / 100
      const payload = { ...form, poNumber: form.poYearRows?.[0]?.poNumber || '', items: form.items.map((item) => ({ ...item, basicAmount: form.pricingMode === 'combined' ? 0 : item.basicAmount })), companyName: form.leadDetails.companyName, subtotal: total, gstRate: 18, gstAmount: tax, grandTotal: total + tax }
      const response = editingId ? await api.put(API_ENDPOINTS.proformaInvoices.detail(editingId), payload) : await api.post(API_ENDPOINTS.proformaInvoices.create, payload)
      setNotice(`${response.data.proformaInvoice?.proformaNumber || 'Proforma Invoice'} saved successfully.`)
      setForm({ ...blankForm, leadDetails: { ...blankLead }, items: [{ ...blankItem }], terms: [''] }); setEditingId(''); await load()
    } catch (err) { setError(readApiError(err, 'Unable to save Proforma Invoice.')) }
    finally { setSaving(false) }
  }

  return <DashboardShell currentUser={user}><div className="min-h-screen bg-gradient-to-br from-[#effaf7] via-white to-[#fff7ef] px-4 py-6 sm:px-7"><div className="mx-auto max-w-[1540px]">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><button onClick={() => navigate('/dashboard')} className="grid h-11 w-11 place-items-center rounded-xl border border-emerald-100 bg-white text-orange-600 shadow-sm"><ArrowLeft /></button><div><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-700">Sales & Billing</p><h1 className="text-3xl font-black text-slate-950">Proforma Invoice</h1><p className="text-sm font-semibold text-slate-500">Create manually or auto-fetch every field from an approved quotation.</p></div></div><button onClick={load} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 font-black text-emerald-700"><RefreshCw className="h-4 w-4" /> Refresh</button></header>
    {(error || notice) && <div className={`mt-5 rounded-2xl border px-5 py-4 font-bold ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}

    <section className="mt-6 overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-[0_20px_60px_rgba(15,93,70,.09)]"><div className="border-b bg-gradient-to-r from-emerald-50 to-orange-50 p-5"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-700 text-white"><FileCheck2 /></span><div><h2 className="text-xl font-black">{editingId ? 'Edit Proforma Invoice' : 'Create Proforma Invoice'}</h2><p className="text-sm font-semibold text-slate-500">Select a quotation for instant auto-fetch, or enter a new invoice manually.</p></div></div></div>
      <div className="px-5"><ProformaPoYearTable form={form} setForm={setForm} /></div>
      <div className="p-5"><div className="mt-2 grid gap-4 lg:grid-cols-4"><label className="lg:col-span-2"><span className="mb-2 block text-sm font-black">Select Quotation</span><QuotationPicker value={form.quotationId || ''} quotations={quotations} onChange={selectQuotation} /></label><label className="lg:col-span-2"><span className="mb-2 block text-sm font-black">Quotation Number *</span><input value={form.quotationNumber} readOnly={Boolean(form.quotationId)} onChange={(e) => setForm((c) => ({ ...c, quotationNumber: e.target.value }))} className="h-14 w-full rounded-2xl border px-4 font-black read-only:bg-slate-100" placeholder="AT/26-27/001" /></label><label><span className="mb-2 block text-sm font-black">Invoice Date</span><input type="date" value={form.invoiceDate} onChange={(e) => setForm((c) => ({ ...c, invoiceDate: e.target.value }))} className="h-12 w-full rounded-xl border px-4 font-bold" /></label><label><span className="mb-2 block text-sm font-black">Valid Until</span><input type="date" value={form.validUntil} onChange={(e) => setForm((c) => ({ ...c, validUntil: e.target.value }))} className="h-12 w-full rounded-xl border px-4 font-bold" /></label></div>
      <h3 className="mb-3 mt-7 text-lg font-black">Client & Quotation Details</h3><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{leadFields.map(([key, label]) => <label key={key}><span className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span><input value={form.leadDetails[key] || ''} onChange={(e) => setLead(key, e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 px-3 font-bold outline-none focus:border-emerald-400" placeholder={`Enter ${label.toLowerCase()}`} /></label>)}</div>
      <section className="mt-6 rounded-2xl border p-5"><h3 className="mb-4 text-lg font-black">Invoice, Delivery & Bank Details</h3><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{invoiceFields.map(([key, label, fallback]) => <label key={key}><span className="mb-2 block text-xs font-bold">{label}</span><textarea rows={2} value={form.invoiceDetails?.[key] ?? fallback ?? ''} onChange={(e) => setForm((c) => ({ ...c, invoiceDetails: { ...Object.fromEntries(invoiceFields.map(([k, , v]) => [k, v || ''])), ...c.invoiceDetails, [key]: e.target.value } }))} className="w-full rounded-xl border p-3 text-sm" /></label>)}</div></section>
      <div className="mb-3 mt-7 flex items-center justify-between"><div><h3 className="text-lg font-black">Invoice Items</h3><p className="text-xs font-bold text-slate-500">{form.pricingMode ? `${form.pricingMode === 'combined' ? 'Combined' : 'Individual'} pricing selected` : 'Choose pricing type first.'}</p></div>{form.pricingMode && <button onClick={() => setForm((c) => ({ ...c, items: [...c.items, { ...blankItem }] }))} className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 font-black text-emerald-700"><Plus className="h-4 w-4" /> Add Item</button>}</div>
      {!form.pricingMode ? <div className="grid gap-4 rounded-2xl border p-5 sm:grid-cols-2"><button type="button" onClick={() => setForm((c) => ({ ...c, pricingMode: 'combined', combinedBasicAmount: '', items: c.items.map((item) => ({ ...item, basicAmount: '' })) }))} className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-5 text-left"><strong className="text-emerald-800">Combined Price</strong><span className="mt-1 block text-sm font-bold text-emerald-700">One total amount for all invoice rows.</span></button><button type="button" onClick={() => setForm((c) => ({ ...c, pricingMode: 'individual', combinedBasicAmount: '' }))} className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-5 text-left"><strong className="text-blue-800">Individual Price</strong><span className="mt-1 block text-sm font-bold text-blue-700">Separate amount for every invoice row.</span></button></div> : <><div className="mb-3 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"><span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${form.pricingMode === 'combined' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>{form.pricingMode} Price</span><button type="button" onClick={() => setForm((c) => ({ ...c, pricingMode: '', combinedBasicAmount: '' }))} className="text-xs font-black text-slate-500">Change pricing type</button></div><div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[1420px] text-left text-sm"><thead className="bg-emerald-800 text-white"><tr>{['Business Category', 'Service Category', 'Services Year', 'Select Period', 'Transition Period', 'Applicant Type', 'Sub Applicant Type', 'Qty / Unit', 'Basic Amount', ''].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{form.items.map((item, index) => <tr key={index} className="border-b"><td className="p-2"><input value={item.businessCategory || ''} onChange={(e) => setItem(index, 'businessCategory', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold" /></td><td className="p-2"><input value={item.serviceCategory || ''} onChange={(e) => setItem(index, 'serviceCategory', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold" /></td><td className="p-2"><input value={item.servicesForYear || ''} onChange={(e) => setItem(index, 'servicesForYear', e.target.value)} className="h-10 w-full rounded-lg border px-2" /></td><td className="p-2"><select value={item.periodUnit || 'annual'} onChange={(e) => setItem(index, 'periodUnit', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold"><option value="days">Days</option><option value="months">Month</option><option value="annual">Annual</option></select></td><td className="p-2"><select value={item.transitionPeriod || 'No'} onChange={(e) => setItem(index, 'transitionPeriod', e.target.value)} className="h-10 w-full rounded-lg border px-2 font-bold"><option value="Yes">Yes</option><option value="No">No</option></select></td><td className="p-2"><input value={item.piboParent || ''} onChange={(e) => setItem(index, 'piboParent', e.target.value)} className="h-10 w-full rounded-lg border px-2" /></td><td className="p-2"><input value={item.piboCategory || ''} onChange={(e) => setItem(index, 'piboCategory', e.target.value)} className="h-10 w-full rounded-lg border px-2" /></td><td className="p-2"><input value={item.unit || ''} onChange={(e) => setItem(index, 'unit', e.target.value)} className="h-10 w-24 rounded-lg border px-2" /></td>{form.pricingMode === 'individual' && <td className="p-2"><input type="number" value={item.basicAmount ?? ''} onChange={(e) => setItem(index, 'basicAmount', e.target.value)} className="h-10 w-36 rounded-lg border px-2 font-black" /></td>}{form.pricingMode === 'combined' && index === 0 && <td rowSpan={form.items.length} className="bg-emerald-50 p-3 align-middle"><label className="text-[10px] font-black uppercase text-emerald-700">Combined Amount</label><input type="number" value={form.combinedBasicAmount ?? ''} onChange={(e) => setForm((c) => ({ ...c, combinedBasicAmount: e.target.value }))} className="mt-2 h-11 w-40 rounded-lg border border-emerald-300 px-3 font-black" placeholder="50000" /></td>}<td className="p-2"><button disabled={form.items.length === 1} onClick={() => setForm((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))} className="grid h-9 w-9 place-items-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></>}
      <div className="mt-6 grid gap-5 lg:grid-cols-2"><label><span className="mb-2 block text-sm font-black">Terms & Conditions</span><textarea value={form.terms.join('\n')} onChange={(e) => setForm((c) => ({ ...c, terms: e.target.value.split(/\r?\n/) }))} rows={6} className="w-full rounded-2xl border p-4 font-semibold outline-none" placeholder="One term per line" /></label><label><span className="mb-2 block text-sm font-black">Scope of Work</span><textarea value={(form.scopeOfWork || []).join('\n')} onChange={(e) => setForm((c) => ({ ...c, scopeOfWork: e.target.value.split(/\r?\n/) }))} rows={6} className="w-full rounded-2xl border p-4 font-semibold outline-none" placeholder="One scope item per line" /></label></div><div className="mt-5 ml-auto max-w-sm rounded-2xl bg-gradient-to-br from-emerald-800 to-teal-700 p-5 text-white"><span className="text-xs font-black uppercase tracking-wider text-emerald-200">Grand Total</span><strong className="mt-2 block text-3xl">{money(total)}</strong><p className="mt-2 text-sm text-emerald-100">Calculated automatically from quantity × basic amount.</p><button disabled={saving} onClick={save} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 font-black shadow-lg transition hover:bg-orange-400 disabled:opacity-50"><Save className="h-5 w-5" /> {saving ? 'Saving…' : editingId ? 'Update Invoice' : 'Save Proforma Invoice'}</button></div></div>
    </section>

    <section className="mt-7 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"><header className="flex items-center justify-between border-b p-5"><div><h2 className="text-xl font-black">Saved Proforma Invoices</h2><p className="text-sm font-semibold text-slate-500">{rows.length} records stored in CRM database</p></div></header><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr>{['Proforma No.', 'Quotation No.', 'PO Number', 'Company', 'Date', 'Amount', 'Status', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row._id} className="border-b transition hover:bg-emerald-50/30"><td className="p-4 font-black text-emerald-700">{row.proformaNumber}</td><td className="p-4 font-bold">{row.quotationNumber}</td><td className="p-4 font-bold">{row.poNumber}</td><td className="p-4 font-black">{row.companyName}</td><td className="p-4">{String(row.invoiceDate || '').slice(0, 10)}</td><td className="p-4 font-black">{money(row.grandTotal)}</td><td className="p-4"><span className="rounded-full bg-emerald-50 px-3 py-1 font-black text-emerald-700">{row.status}</span></td><td className="p-4"><div className="flex gap-2"><button title="View details" onClick={() => setDetailRow(row)} className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50"><Eye className="h-4 w-4" /></button><button title="Download PDF" onClick={() => downloadProforma(row)} className="grid h-9 w-9 place-items-center rounded-lg border border-sky-200 text-sky-700 hover:bg-sky-50"><Download className="h-4 w-4" /></button><button onClick={() => edit(row)} className="rounded-lg border border-orange-200 px-3 py-2 font-black text-orange-600 hover:bg-orange-50">Edit</button></div></td></tr>)}{!rows.length && <tr><td colSpan="8" className="p-12 text-center font-bold text-slate-400">{loading ? 'Loading…' : 'No Proforma Invoices created yet.'}</td></tr>}</tbody></table></div></section>
    <ProformaDetail row={detailRow} onClose={() => setDetailRow(null)} onEdit={(row) => { setDetailRow(null); edit(row) }} />
  </div></div></DashboardShell>
}
