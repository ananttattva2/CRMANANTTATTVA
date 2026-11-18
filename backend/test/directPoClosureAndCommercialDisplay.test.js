const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync(require('node:path').resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
const quoteSource = fs.readFileSync(require('node:path').resolve(__dirname, '../../frontend/src/utils/leadClosureQuotation.js'), 'utf8');
const quoteModule = import(`data:text/javascript;base64,${Buffer.from(quoteSource).toString('base64')}`);
const request = page.slice(page.indexOf('  function requestLeadClosure('), page.indexOf('  async function uploadClosureFile'));
const opening = page.slice(page.indexOf('  function openLeadPoDetails('), page.indexOf('  const renderClosureDialog ='));
async function open(source, quotations) {
  const { hydrateClosurePoRows, selectLeadClosureQuotation } = await quoteModule;
  const state = {};
  const context = { source, quotations, lead: { _id: 'previous-lead' }, currentUser: { _id: 'user-1' }, staff: [], emptyLead: {}, hydrateClosurePoRows, selectLeadClosureQuotation,
    hasSavedPoDetails: (assignment) => Boolean((assignment?.poYearRows || []).some(row => row?.poNumber && row?.poDate && Number(row?.poAmount) > 0 && row?.poFileUrl)
      || (assignment?.originalPoDetails?.poNumber && assignment?.originalPoDetails?.poFileUrl)),
    showToast: () => {},
    normalizeLegacyServiceSelections: (lead) => lead.serviceSelections,
    primaryLeadOwner: () => ({ id: 'owner-1', name: 'Owner' }),
    setLead: (value) => { state.lead = value; }, setEditingLeadId: (value) => { state.id = value; },
    setClosureDialog: (value) => { state.dialog = typeof value === 'function' ? value(state.dialog) : value; }, updateAssignmentRow: () => {} };
  vm.runInNewContext(request + opening + '\nopenLeadPoDetails(source);', context);
  return state;
}
test('direct PO entry opens shared closure workflow with matching quotation and persisted commercial values', async () => {
  const source = { _id: 'lead-1', serviceSelections: [{ assignedServiceId: 'svc-1', servicesOffered: 'Annual Filing', firstAnnualReturnYearApplicable: '2026-27' }], assignments: [{ assignedServiceId: 'svc-1', poYearRows: [{ poNumber: 'PO-100', poDate: '2026-04-01', poAmount: 1000, poFileUrl: 'po.pdf', poEndDate: '2027-03-31', poFinancialYear: '2026-27', paymentTerm: '45 days' }] }] };
  const state = await open(source, [
    { _id: 'wrong', leadId: 'other-lead', updatedAt: '2026-10-02', items: [{ assignedServiceId: 'svc-1' }] },
    { _id: 'correct', leadId: 'lead-1', items: [{ assignedServiceId: 'svc-1', financialYear: '2026-27', servicesOffered: 'Annual Filing', basicAmount: 1000 }] }
  ]);
  assert.equal(state.id, 'lead-1'); assert.equal(state.dialog.quotation._id, 'correct');
  assert.equal(state.dialog.poEditor, true); assert.equal(state.dialog.choice, 'yes'); assert.equal(state.dialog.quotationSent, 'yes');
  assert.equal(state.dialog.poYearRows[0].paymentTerm, '45 days');
  assert.equal(state.dialog.poYearRows[0].poEndDate, '2027-03-31');
  assert.equal(state.dialog.poYearRows[0].poFinancialYear, '2026-27');
});

test('EPR Credit closure opens a PO row for each selected service', async () => {
  const { hydrateClosurePoRows, selectLeadClosureQuotation } = await quoteModule;
  const services = [
    { assignedServiceId: 'credit-eol', businessCategory: 'EPR Credit', eprCategory: 'EPR - Plastic Waste', subApplicantType: 'Producer', servicesOffered: 'Category 1 – EOL', firstAnnualReturnYearApplicable: '2025-26' },
    { assignedServiceId: 'credit-recycling', businessCategory: 'EPR Credit', eprCategory: 'EPR - Plastic Waste', subApplicantType: 'Producer', servicesOffered: 'Category 1 – Recycling', firstAnnualReturnYearApplicable: '2025-26' }
  ];
  const source = { _id: 'credit-lead', company: 'Example Producer', serviceSelections: services, assignments: services.map((service) => ({ assignedServiceId: service.assignedServiceId })) };
  const quotation = {
    _id: 'credit-quote',
    leadId: 'credit-lead',
    items: services.map((service, index) => ({
      assignedServiceId: service.assignedServiceId,
      servicesOffered: service.servicesOffered,
      financialYear: service.firstAnnualReturnYearApplicable,
      basicAmount: (index + 1) * 100
    }))
  };
  const state = {};
  const context = {
    source,
    quotations: [quotation],
    lead: source,
    currentUser: { _id: 'user-1' },
    staff: [],
    hasSavedPoDetails: () => false,
    normalizeLegacyServiceSelections: (lead) => lead.serviceSelections,
    selectLeadClosureQuotation,
    hydrateClosurePoRows,
    primaryLeadOwner: () => ({ id: 'owner-1', name: 'Owner' }),
    setClosureDialog: (value) => { state.dialog = value; }
  };

  vm.runInNewContext(`${request}\nrequestLeadClosure(0, 'user-1', source);`, context);

  assert.equal(state.dialog.eprCreditMultiService, true);
  assert.deepEqual(state.dialog.eprCreditServiceOptions.map((service) => service.assignedServiceId), ['credit-eol', 'credit-recycling']);
  assert.deepEqual(state.dialog.poYearRows.map((row) => row.assignedServiceId), ['credit-eol', 'credit-recycling']);
  assert.deepEqual(state.dialog.poYearRows.map((row) => row.services[0]), ['Category 1 – EOL', 'Category 1 – Recycling']);
});
test('manual PO entry retains earlier quotation proof and service period when reopened directly', async () => {
  const source = { _id: 'lead-2', serviceSelections: [{ assignedServiceId: 'svc-2', servicesOffered: 'Registration', firstAnnualReturnYearApplicable: '2026-27' }], assignments: [{ assignedServiceId: 'svc-2', quotationSent: 'no', earlierQuotationProofUrl: 'https://example.com/quote.pdf', earlierQuotationProofName: 'quote.pdf', poYearRows: [{ fy: '2026-27', services: ['Registration'], poNumber: 'PO-200', poDate: '2026-01-12', poAmount: 250, poFileUrl: 'https://example.com/po.pdf' }] }] };
  const state = await open(source, []);
  assert.equal(state.dialog.quotationSent, 'no');
  assert.equal(state.dialog.earlierQuotationProofUrl, 'https://example.com/quote.pdf');
  assert.equal(state.dialog.poYearRows[0].fy, '2026-27');
  assert.equal(state.dialog.poYearRows[0].services[0], 'Registration');
});
test('selected Annual Return service overrides a stale New Registration label without losing PO values', async () => {
  const source = { _id: 'lead-0386', serviceSelections: [
    { assignedServiceId: 'annual-importer', subApplicantType: 'Importer', servicesOffered: 'Annual Return Filling', firstAnnualReturnYearApplicable: '2024-25' },
    { assignedServiceId: 'annual-brand', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling', firstAnnualReturnYearApplicable: '2024-25' },
    { assignedServiceId: 'registration', servicesOffered: 'New Registration', firstAnnualReturnYearApplicable: '2026-27' }
  ], assignments: [
    { assignedServiceId: 'annual-importer', quotationSent: 'no', poYearRows: [{ fy: '2026-27', services: ['New Registration'], poNumber: '2025090099', poDate: '2025-09-01', poAmount: 50000, poFileUrl: 'proof.pdf' }] },
    { assignedServiceId: 'annual-brand' }, { assignedServiceId: 'registration' }
  ] };
  const state = await open(source, []);
  assert.equal(state.dialog.poYearRows[0].services[0], 'Annual Return Filling');
  assert.equal(state.dialog.poYearRows[0].fy, '2024-25');
  assert.equal(state.dialog.poYearRows[0].poNumber, '2025090099');
  assert.equal(state.dialog.poYearRows[0].poAmount, 50000);
  assert.equal(state.dialog.poYearRows[0].poFileUrl, 'proof.pdf');
});
test('dashboard PO details preserve explicit PO financial year separately from the service period', () => {
  const admin = fs.readFileSync(require('node:path').resolve(__dirname, '../../frontend/src/pages/AdminDashboard.jsx'), 'utf8');
  const source = admin.slice(admin.indexOf('function getCompliancePoDetails('), admin.indexOf('function getPerformanceTone('));
  const po = { poNumber: 'PO-100', fy: '2025-26', poFinancialYear: '2026-27', poEndDate: '2027-03-31', paymentTerm: '30 days' };
  const context = { po, readClientData: () => ({}), getLeadPurchaseOrder: () => po, getPoValue: (...values) => values.find(Boolean) || '', getAnnualReturnDraftValue: () => '', getFileDisplayValue: () => '', getFileUrl: () => '' };
  vm.runInNewContext(source + '\nresult = getCompliancePoDetails({}, [], [], []);', context);
  assert.equal(context.result.poEndDate, '2027-03-31'); assert.equal(context.result.poFinancialYear, '2026-27'); assert.equal(context.result.paymentTerm, '30 days');
});
