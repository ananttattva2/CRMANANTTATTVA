const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
const services = Array.from({ length: 8 }, (_, index) => ({
  assignedServiceId: `service-${index}`, servicesOffered: `Service ${index}`,
  firstAnnualReturnYearApplicable: '2026-27', createdByName: index > 1 ? 'Other User' : 'Current User'
}));
const lead = { _id: 'lead-1', leadCode: 'ATPL-1', serviceSelections: services };

function prepare() {
  const state = {};
  const context = {
    leads: [lead], quotations: [{ _id: 'old-quote', leadId: 'lead-1', status: 'submitted', pricingMode: 'individual', items: services.slice(0, 2), validUntil: '2026-10-16' }],
    currentUser: { name: 'Current User' }, emptyItem: { basicAmount: '' },
    emptyQuotation: { status: 'draft', pricingMode: '', combinedBasicAmount: '', combinedPricingGroups: [], validUntil: '', paymentTerm: '' },
    emptyLeadDetails: {}, leadServiceIsClosed: (_, index) => index === 7,
    serviceBelongsToUser: row => row.createdByName === 'Current User',
    quotationApplicantSelection: () => ({ parent: 'PIBO', child: 'Brand Owner' }),
    quotationItemIdentity: row => row.assignedServiceId,
    normalizeDateInputValue: value => value || '', displayLeadCode: item => item.leadCode,
    mapLeadToDetails: () => ({ companyName: 'Company' }),
    findLeadForQuotation: () => lead, syncQuotationItemsWithLead: items => items,
    normalizeCombinedPricingGroups: () => [], quotationOwnerName: () => 'Owner', quotationPreparedByName: () => 'Owner',
    quotationPaymentTerm: row => row.paymentTerm || '', canReviseQuotation: () => true
  };
  for (const [, name] of source.matchAll(/\b(set\w+)\(/g)) context[name] = value => {
    state[name] = typeof value === 'function' ? value(state[name] || {}) : value;
  };
  vm.createContext(context);
  const mapStart = source.indexOf('function mapLeadServiceRows(');
  vm.runInContext(source.slice(mapStart, source.indexOf('function isCombinedQuotation(', mapStart)), context);
  return { context, state };
}

test('Add Quotation starts a new record with all eight services despite an existing two-item quotation', () => {
  const { context, state } = prepare();
  const start = source.indexOf('  function selectLead(');
  vm.runInContext(source.slice(start, source.indexOf('  function confirmLeadIdentity(', start)), context);
  vm.runInContext("selectLead('lead-1', { fromName: 'New Owner', preparedByName: 'New Preparer' });", context);
  assert.equal(state.setEditingId, '');
  assert.equal(state.setQuotation.items.length, 8);
  assert.equal(state.setQuotation.items[7].assignedServiceId, 'service-7');
  assert.equal(state.setQuotation.status, 'draft');
  assert.equal(state.setQuotation.validUntil, '');
  assert.equal(state.setQuotation.pricingMode, '');
  assert.ok(state.setQuotation.items.every(item => item.basicAmount === ''));
  assert.equal(state.setQuotation.terms.length, 0);
  assert.equal(state.setQuotation.scopeOfWork.length, 0);
});

test('explicit Revise keeps the selected quotation ID and its two saved items', () => {
  const { context, state } = prepare();
  context.row = { _id: 'approved-quote', leadId: 'lead-1', status: 'approved', pricingMode: 'individual', items: [{ assignedServiceId: 'service-0', basicAmount: 75000 }, { assignedServiceId: 'service-1', basicAmount: 25000 }] };
  const start = source.indexOf('  function editQuotation(');
  vm.runInContext(`${source.slice(start, source.indexOf('  function requestLeadSelection(', start))} editQuotation(row);`, context);
  assert.equal(state.setEditingId, 'approved-quote');
  assert.equal(state.setQuotation.items.length, 2);
  assert.equal(state.setQuotation.items[0].basicAmount, 75000);
});
