const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('PO approval review opens the linked CRM quotation inside the current dialog', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8')
  assert.match(source, /View Quotation/)
  assert.match(source, /po\.isSystemQuotation && Boolean\(po\.quotationId \|\| po\.quotationNumber\)/)
  assert.match(source, /api\.get\(API_ENDPOINTS\.quotations\.detail\(quotationId\)\)/)
  assert.match(source, /setPoQuotationPreview\(\{ loading: true/)
  assert.match(source, /<PremiumQuotationModal open/)
  assert.match(source, /pricingMode=\{quotation\.pricingMode \|\| 'individual'\}/)
  assert.match(source, /combinedPricingGroups=\{quotation\.combinedPricingGroups\}/)
  assert.doesNotMatch(source.match(/async function openPoQuotation[\s\S]*?\n  \}/)?.[0] || '', /navigate\(/)
  assert.match(source, /onViewQuotation=\{openPoQuotation\}/)
})

test('quotation preview displays services offered separately from service and EPR categories', () => {
  const modal = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/PremiumQuotationModal.jsx'), 'utf8')
  assert.match(modal, /'Services Offered'/)
  assert.match(modal, /item\.servicesOffered \|\| item\.applicableService/)
  assert.match(modal, /'EPR Category'/)
})

test('quotation status reads the annual return year for each item, including older saved quotations', async () => {
  const { quotationAnnualReturnYearLabel } = await import('../../frontend/src/utils/quotationDocument.mjs')
  assert.equal(quotationAnnualReturnYearLabel({
    servicesOffered: 'Annual Return Filling', annualReturnYears: ['2025-26', '2026-27'],
    servicesForYear: '2027-28', registrationYear: '2024-25'
  }), '2025-26, 2026-27')
  assert.equal(quotationAnnualReturnYearLabel({ applicableService: 'Annual Filing', servicesForYear: '2027-28' }), '2027-28')
  assert.equal(quotationAnnualReturnYearLabel({
    servicesOffered: 'Annual Return', serviceStartDate: '2028-04-01', serviceEndDate: '2029-03-31'
  }), '2028-29')
  assert.equal(quotationAnnualReturnYearLabel({ servicesOffered: 'Annual Return' }), '—')
  assert.equal(quotationAnnualReturnYearLabel({
    servicesOffered: ' ',
    applicableService: 'Annual Return Filling',
    firstAnnualReturnYearApplicable: '2026-27'
  }), '2026-27')
  assert.equal(quotationAnnualReturnYearLabel({
    serviceName: 'Annual Return',
    annualReturnYear: '2025-26'
  }), '2025-26')
  assert.equal(quotationAnnualReturnYearLabel({ servicesOffered: 'New Registration', servicesForYear: '2027-28' }), null)
})
