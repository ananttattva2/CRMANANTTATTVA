const test = require('node:test');
const assert = require('node:assert/strict');
const Lead = require('../src/models/Lead');
const { attachQuotationServiceStatus, itemClosureStates } = require('../src/services/quotationServiceStatus');

test('quotation directory reads current closures and splits counts and amounts for the same quotation', async t => {
  const { filterQuotationServices } = await import('../../frontend/src/utils/quotationServiceView.mjs');
  const items = [10000, 15000, 8000, 15000, 12000, 12000].map((basicAmount, index) => ({
    assignedServiceId: `service-${index}`, sourceServiceIndex: index, basicAmount, unit: 1
  }));
  const quotation = { leadCode: 'ATPL-0646', items, serviceState: 'closed', grandTotal: 72000 };
  const lead = {
    _id: '507f1f77bcf86cd799439011',
    leadCode: quotation.leadCode,
    status: 'closed',
    closedAt: '2026-11-25',
    serviceSelections: items,
    assignments: [
      { assignedServiceId: 'service-5', closedByText: 'Manager' },
      { assignedServiceId: 'service-4', closedAt: '2026-11-25' }
    ]
  };
  const find = t.mock.method(Lead, 'find', () => ({ select: () => ({ lean: async () => [lead] }) }));
  const [row] = await attachQuotationServiceStatus([quotation]);
  assert.equal(row.linkedLeadId, lead._id);
  const open = filterQuotationServices(row, 'open');
  const closed = filterQuotationServices(row, 'closed');
  assert.deepEqual(open.items, items.slice(0, 4));
  assert.equal(open.total, 48000);
  assert.deepEqual(closed.items, items.slice(4));
  assert.equal(closed.total, 24000);
  assert.equal(row.grandTotal, 72000);
  assert.equal(row.items.length, 6);

  lead.assignments.push({ assignedServiceId: 'service-0', closedAt: '2026-11-26' });
  const [refreshed] = await attachQuotationServiceStatus([quotation]);
  assert.equal(filterQuotationServices(refreshed, 'closed').total, 34000);
  assert.equal(find.mock.callCount(), 2);
});

test('legacy quotation items use compatible service labels and reject mismatched IDs', () => {
  const lead = { serviceSelections: [
    { assignedServiceId: 'producer', piboCategory: 'Producer', servicesOffered: 'Annual Return', closedAt: '2026-11-25' },
    { assignedServiceId: 'importer', piboCategory: 'Importer', servicesOffered: 'Annual Return' }
  ] };
  assert.deepEqual(itemClosureStates({ items: [
    { sourceServiceIndex: 0, piboCategory: 'Importer', servicesOffered: 'Annual Return' },
    { piboCategory: 'Producer', servicesOffered: 'Annual Return' },
    { assignedServiceId: 'manual', sourceServiceIndex: 0 }
  ] }, lead), ['open', 'closed', 'open']);
});

test('a fully closed lead closes a historical quote line with an outdated service ID', () => {
  const lead = {
    status: 'closed',
    serviceSelections: [
      { assignedServiceId: 'registration', servicesOffered: 'New Registration' },
      { assignedServiceId: 'return-2027', servicesOffered: 'Annual Return Filling', servicesForYear: '2027-28' },
      { assignedServiceId: 'return-2028', servicesOffered: 'Annual Return Filling', servicesForYear: '2028-29' }
    ],
    assignments: [
      { assignedServiceId: 'registration', closedAt: '2026-11-24' },
      { assignmentId: 'return-2027', closedByText: 'Manager' },
      { assignedServiceId: 'return-2028', poStatus: 'permanently_closed' }
    ]
  };
  const quote = { serviceState: 'open', items: [
    { assignedServiceId: 'registration' },
    { assignedServiceId: 'return-2027' },
    { assignedServiceId: 'old-return-2028', sourceServiceIndex: 2, servicesOffered: 'Annual Return Filling', servicesForYear: '2028-29' }
  ] };
  assert.deepEqual(itemClosureStates(quote, lead), ['closed', 'closed', 'closed']);
  lead.assignments[2].poStatus = 'received';
  assert.deepEqual(itemClosureStates(quote, lead), ['closed', 'closed', 'open']);
});

test('dashboard quotation filters use the lead creation period and resolved lead ID', async () => {
  const { quotationLeadIdsInPeriod, quotationMatchesLeadIds } = await import('../../frontend/src/utils/quotationServiceView.mjs');
  const scope = quotationLeadIdsInPeriod([
    { id: 'hot-in-period', kind: 'hot', state: 'closed', createdAt: '2026-11-20' },
    { id: 'hot-outside', kind: 'hot', createdAt: '2026-10-20' },
    { id: 'cold', kind: 'cold', createdAt: '2026-11-20' }
  ], { start: Date.parse('2026-11-01'), end: Date.parse('2026-12-01') });
  assert.deepEqual([...scope], ['hot-in-period', 'cold']);
  assert.ok(quotationMatchesLeadIds({ linkedLeadId: 'hot-in-period', leadId: 'legacy-code' }, scope));
  assert.equal(quotationMatchesLeadIds({ linkedLeadId: 'hot-outside' }, scope), false);
});

test('combined prices remain whole when a group spans both quotation tabs', async () => {
  const { filterQuotationServices } = await import('../../frontend/src/utils/quotationServiceView.mjs');
  const row = {
    items: [{ assignedServiceId: 'a' }, { assignedServiceId: 'b' }],
    itemClosureStates: ['open', 'closed'],
    grandTotal: 500,
    pricingMode: 'combined',
    combinedPricingGroups: [{ itemKeys: ['a', 'b'], basicAmount: 500 }]
  };
  assert.equal(filterQuotationServices(row, 'open').total, null);
  assert.equal(filterQuotationServices(row, 'closed').total, null);
  row.combinedPricingGroups = [{ itemKeys: ['a'], basicAmount: 200 }, { itemKeys: ['b'], basicAmount: 300 }];
  assert.equal(filterQuotationServices(row, 'open').total, 200);
  assert.equal(filterQuotationServices(row, 'closed').total, 300);
});
