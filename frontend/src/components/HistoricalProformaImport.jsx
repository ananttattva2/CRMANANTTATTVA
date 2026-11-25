import React, { useState } from 'react'
import api, { readApiError } from '../services/api'
import { API_ENDPOINTS } from '../services/apiEndpoints'

const columns = {
  'PI Number': 'proformaNumber', 'Invoice Date': 'invoiceDate', 'Company Name': 'companyName',
  'GSTIN': 'gstNumber', 'Billing Address': 'addressLine1', 'City': 'city', 'State': 'state', 'PIN Code': 'pinCode',
  'Quotation Number': 'quotationNumber', 'PO Number': 'poNumber', 'Payment Terms': 'paymentTerms',
  'GST Rate (%)': 'gstRate', 'Original Grand Total': 'expectedTotal', 'Status': 'status',
  'Service Category': 'serviceCategory', 'Description': 'description', 'Quantity': 'quantity',
  'Unit Price Before GST': 'unitPrice'
}

async function readWorkbook(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose a template file under 2 MB.')
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', sheetRows: 2502, sheets: ['Historical PIs'] })
  const sheet = workbook.Sheets['Historical PIs']
  if (!sheet) throw new Error('Use the Historical PIs sheet in the download template.')
  const [headings = [], ...rows] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
  const fields = headings.map(heading => columns[String(heading).trim()])
  if (Object.values(columns).some(field => fields.filter(key => key === field).length !== 1)) {
    throw new Error('Keep the column headings from the template.')
  }
  return rows.map((cells, index) => {
    const entries = Object.entries(fields).filter(([, key]) => key).map(([column, key]) => {
      const cell = cells[column]
      if (key === 'invoiceDate' && typeof cell === 'number') {
        const date = XLSX.SSF.parse_date_code(cell, { date1904: workbook.Workbook?.WBProps?.date1904 })
        const iso = date && [date.y, String(date.m).padStart(2, '0'), String(date.d).padStart(2, '0')].join('-')
        return [key, iso || cell]
      }
      return [key, cell]
    })
    return { ...Object.fromEntries(entries), rowNumber: index + 2 }
  })
}

export default function HistoricalProformaImport({ onImported }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function submit(event) {
    event.preventDefault()
    if (!file || busy) return
    const form = event.currentTarget
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const rows = await readWorkbook(file)
      const { data } = await api.post(API_ENDPOINTS.proformaInvoices.importHistorical, { rows })
      setResult(data)
      setFile(null)
      form.reset()
      await onImported()
    } catch (failure) {
      setError(readApiError(failure, 'Unable to import historical proforma invoices.'))
    } finally {
      setBusy(false)
    }
  }

  return <details className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4">
    <summary className="cursor-pointer font-bold text-emerald-800">Import Historical Proforma Invoices</summary>
    <form onSubmit={submit} className="mt-3 space-y-3">
      <p className="text-sm text-slate-600">Upload the original details for ATPI/26-27/001 through ATPI/26-27/202. Repeat the PI number for additional line items. Existing numbers are skipped.</p>
      <div className="flex flex-wrap items-center gap-3">
        <a href="/historical-proforma-template.xlsx" download className="rounded-lg border px-3 py-2 text-sm font-bold text-emerald-800">Download Excel Template</a>
        <input type="file" accept=".xlsx" aria-label="Historical proforma workbook" disabled={busy} required
          onChange={event => { setFile(event.target.files[0] || null); setResult(null); setError('') }} className="max-w-full text-sm"/>
        <button type="submit" disabled={busy || !file} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
          {busy ? 'Importing…' : 'Import and Save'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {result && <p role="status" className="text-sm text-emerald-800">Saved {result.created} invoice(s). Skipped {result.skipped} existing number(s).</p>}
    </form>
  </details>
}

