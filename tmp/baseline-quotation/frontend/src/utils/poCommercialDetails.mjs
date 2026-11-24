export const PO_FINANCIAL_YEARS = Array.from({ length: 8 }, (_, index) => `${2022 + index}-${String(2023 + index).slice(-2)}`)
export function poCommercialError(row = {}) {
  if (!row.poEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(row.poEndDate) || Number.isNaN(Date.parse(row.poEndDate)) || new Date(row.poEndDate).toISOString().slice(0, 10) !== row.poEndDate) return 'Enter a valid PO End Date.'
  if (row.poDate && row.poEndDate < row.poDate) return 'PO End Date cannot be before PO Date.'
  if (!PO_FINANCIAL_YEARS.includes(row.poFinancialYear)) return 'Choose a PO Financial Year from 2022-23 to 2029-30.'
  if (row.registrationYear && !PO_FINANCIAL_YEARS.includes(row.registrationYear)) return 'Choose a Registration Year from 2022-23 to 2029-30.'
  if (row.annualReturnYear && !PO_FINANCIAL_YEARS.includes(row.annualReturnYear)) return 'Choose an Annual Return Year from 2022-23 to 2029-30.'
  if (!String(row.paymentTerm || '').trim()) return 'Enter the Payment Term.'
  return ''
}

export function poYearField(po = {}, selectedService = {}) {
  const selected = selectedService.servicesOffered || selectedService.applicableService
  const recorded = Array.isArray(po.services) && po.services.length ? po.services : (typeof po.services === 'string' ? po.services : '') || po.service || po.servicesOffered || po.applicableService || ''
  const source = selected || recorded
  const services = (Array.isArray(source) ? source : [source]).flatMap(value => String(value).split(/[,;\n]/))
  return services.some(service => /^(?:new)?registration$/.test(service.toLowerCase().replace(/[^a-z]/g, ''))) ? 'registrationYear' : 'annualReturnYear'
}
export function poYearLabel(rows = [], selectedService = {}) {
  const fields = new Set((rows.length ? rows : [{}]).map(row => poYearField(row, selectedService)))
  return fields.size > 1 ? 'Annual Return / Registration Year' : fields.has('registrationYear') ? 'Registration Year' : 'Annual Return Year'
}
export function hasSavedPoDetails(assignment = {}) {
  return (assignment.poYearRows || []).some(row => String(row.poNumber || '').trim() && row.poDate && Number(row.poAmount) > 0 && row.poFileUrl)
    || Boolean(assignment.originalPoDetails?.poNumber && assignment.originalPoDetails?.poFileUrl)
}
