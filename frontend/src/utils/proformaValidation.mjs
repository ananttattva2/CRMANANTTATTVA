export function validateProformaPoYears(form = {}) {
  const count = Math.max(0, Math.min(50, Math.floor(Number(form.poYearCount) || 0)))
  const rows = Array.isArray(form.poYearRows) ? form.poYearRows : []
  for (let index = 0; index < count; index += 1) {
    const row = rows[index]
    if (!row || !String(row.fy || '').trim() || !String(row.poNumber || '').trim() || !row.compliancePoFile || !Array.isArray(row.serviceCategory) || !row.serviceCategory.some((service) => String(service || '').trim())) {
      return `PO year ${index + 1}: FY Year, PO Number, PO Upload and Services are required.`
    }
  }
  return ''
}
