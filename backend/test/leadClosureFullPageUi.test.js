const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');

test('lead closure uses a full-screen workspace and shows only the selected quotation service', () => {
  assert.match(source, /fixed inset-0 z-\[12000\] bg-slate-50/);
  assert.match(source, /selectLeadClosureQuotation\(relevantQuotations/);
  assert.match(source, /selectedQuotationItems\.length \? selectedQuotationItems\.map\(quoteRow\)/);
});

test('quotation and PO data share one table with combined and individual amount presentation', () => {
  assert.match(source, /'Basic Amount \(INR\)', 'PO Number', 'PO Date', 'PO End Date', 'PO Financial Year', poYearLabel\(poRows, selectedService\), 'Payment Term', 'PO Amount \(INR\)', 'PO Proof', 'Service'/);
  assert.match(source, /updatePo\(index, \{ poAmount: event\.target\.value \}\)/);
  assert.match(source, /value=\{po\.poAmount \?\? ''\}/);
  assert.match(source, /quotation\.combinedBasicAmount \|\| quotation\.grandTotal/);
  assert.match(source, /quotationBasicAmount: quotation\?\.pricingMode === 'combined'/);
  assert.match(source, /CRM Quotation Value:/);
  assert.match(source, /rowSpan=\{combined \? rows\.length : 1\}/);
  assert.doesNotMatch(source, /Add Extra PO/);
  assert.doesNotMatch(source, /annualReturnYearOptions\.map/);
});
