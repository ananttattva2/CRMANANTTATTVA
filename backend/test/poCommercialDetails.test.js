const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanBody, poClosureSubmissionChanged } = require('../src/controllers/leadController')._test;
const { PO_FINANCIAL_YEARS, validatePoCommercialDetails } = require('../src/utils/poCommercialDetails');
const { permanentlyCloseProvisionalAssignments } = require('../src/utils/provisionalClosureDeadline');
const Lead = require('../src/models/Lead');
const commercial = { poEndDate: '2027-03-31', poFinancialYear: '2026-27', annualReturnYear: '2025-26', registrationYear: '2026-27', paymentTerm: '30 days from invoice date' };
test('manual and CRM quotation PO fields survive sanitization and database serialization', () => {
  for (const quotationSent of ['yes', 'no']) {
    const data = cleanBody({ assignments: [{ quotationSent, poStatus: 'received', poYearRows: [{ fy: '2026-27', poDate: '2026-10-01', ...commercial }] }] });
    const document = new Lead(data);
    const row = document.toObject().assignments[0].poYearRows[0];
    for (const field of Object.keys(commercial)) assert.equal(row[field], commercial[field]);
    assert.equal(document.toObject().assignments[0].quotationSent, quotationSent);
  }
});
test('commercial edits trigger PO review and unchanged rows do not', () => {
  const previous = { poStatus: 'received', poYearRows: [{ poDate: '2026-10-01', ...commercial }] };
  assert.equal(poClosureSubmissionChanged(previous, structuredClone(previous)), false);
  for (const [field, value] of Object.entries({ poEndDate: '2027-04-01', poFinancialYear: '2027-28', annualReturnYear: '2024-25', registrationYear: '2027-28', paymentTerm: '60 days' })) {
    const next = structuredClone(previous); next.poYearRows[0][field] = value;
    assert.equal(poClosureSubmissionChanged(previous, next), true);
  }
});
test('FY choices, invalid calendar dates and PO date ordering are validated; legacy rows remain valid', () => {
  assert.deepEqual(PO_FINANCIAL_YEARS, ['2022-23','2023-24','2024-25','2025-26','2026-27','2027-28','2028-29','2029-30']);
  assert.equal(validatePoCommercialDetails({ poDate: '2026-10-01', ...commercial }), '');
  assert.match(validatePoCommercialDetails({ poEndDate: '2026-02-30' }), /valid/);
  assert.match(validatePoCommercialDetails({ poDate: '2026-10-01', poEndDate: '2026-09-01' }), /before/);
  assert.match(validatePoCommercialDetails({ poFinancialYear: '2030-31' }), /Financial Year/);
  assert.match(validatePoCommercialDetails({ annualReturnYear: '2025-28' }), /Annual Return Year/);
  assert.equal(validatePoCommercialDetails({ poDate: '2026-10-01' }), '');
});
test('original PO permanent closure also persists the commercial fields', () => {
  const result = permanentlyCloseProvisionalAssignments([{ poStatus: 'provisional' }], { id: 'user-1' }, [{ assignmentIndex: 0, ...commercial }]);
  for (const field of Object.keys(commercial)) assert.equal(result.assignments[0].originalPoDetails[field], commercial[field]);
});


test('PO modification requires a saved PO and year field follows the selected service', async () => {
  const { hasSavedPoDetails, poYearField, poYearLabel } = await import('../../frontend/src/utils/poCommercialDetails.mjs');
  assert.equal(hasSavedPoDetails({}), false);
  assert.equal(hasSavedPoDetails({poYearRows:[{poNumber:'1'}]}), false);
  assert.equal(Boolean(hasSavedPoDetails({poYearRows:[{poNumber:'1',poDate:'2026-10-07',poAmount:100,poFileUrl:'proof.pdf'}]})), true);
  for(const service of ['Annual Return', 'Annual Return Filling', 'Annual Filling']) assert.equal(poYearField({services:[service]}),'annualReturnYear');
  for(const service of ['Registration', 'New Registration']) assert.equal(poYearField({services:[service]}),'registrationYear');
  assert.equal(poYearLabel([{services:['New Registration']}]), 'Registration Year');
});
