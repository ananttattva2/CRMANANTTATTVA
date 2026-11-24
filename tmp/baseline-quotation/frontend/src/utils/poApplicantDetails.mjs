const text = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || 'Not recorded'

export function resolvePoApplicantDetails(approval = {}, row = {}) {
  const payload = approval.payload || {}
  const service = payload.service && typeof payload.service === 'object' ? payload.service : {}
  const item = Array.isArray(row.quotationItems) ? row.quotationItems[0] || {} : {}
  return {
    applicant: text(row.applicantType, row.piboParent, item.applicantType, item.piboParent, service.applicantType, service.piboParent, payload.applicantType, payload.piboParent),
    subApplicant: text(row.subApplicantType, row.piboCategory, item.subApplicantType, item.piboCategory, service.subApplicantType, service.piboCategory, payload.subApplicantType, payload.piboCategory)
  }
}
