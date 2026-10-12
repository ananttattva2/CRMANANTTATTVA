const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('PO approval review links CRM quotations to the existing quotation preview', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8')
  assert.match(source, /View Quotation/)
  assert.match(source, /po\.isSystemQuotation && Boolean\(po\.quotationId \|\| po\.quotationNumber\)/)
  assert.match(source, /previewQuotationId: quotationId/)
  assert.match(source, /fromPendingApproval: true/)
  assert.match(source, /onViewQuotation=\{openPoQuotation\}/)
})
