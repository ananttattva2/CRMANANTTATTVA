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
