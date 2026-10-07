export const PO_FINANCIAL_YEARS = Array.from({ length: 8 }, (_, index) => `${2022 + index}-${String(2023 + index).slice(-2)}`)
export function poCommercialError(row = {}) {
  if (!row.poEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(row.poEndDate) || Number.isNaN(Date.parse(row.poEndDate)) || new Date(row.poEndDate).toISOString().slice(0, 10) !== row.poEndDate) return 'Enter a valid PO End Date.'
  if (row.poDate && row.poEndDate < row.poDate) return 'PO End Date cannot be before PO Date.'
  if (!PO_FINANCIAL_YEARS.includes(row.poFinancialYear)) return 'Choose a PO Financial Year from 2022-23 to 2029-30.'
  if (row.annualReturnYear && !PO_FINANCIAL_YEARS.includes(row.annualReturnYear)) return 'Choose an Annual Return Year from 2022-23 to 2029-30.'
  if (!String(row.paymentTerm || '').trim()) return 'Enter the Payment Term.'
  return ''
}
