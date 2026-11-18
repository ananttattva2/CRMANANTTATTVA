import test from 'node:test';
import assert from 'node:assert/strict';
import { groupEprCreditPoRowsByService, selectEprCreditPoService, updateEprCreditPoRows } from '../src/utils/eprCreditPoDetails.mjs';

test('shared EPR Credit PO details update together while PO Amount remains service-specific', () => {
  const rows = [
    { assignedServiceId: 'service-1', poNumber: '', poAmount: '100' },
    { assignedServiceId: 'service-2', poNumber: '', poAmount: '200' }
  ];

  const withSharedDetails = updateEprCreditPoRows(rows, 0, { poNumber: 'PO-123' });
  assert.deepEqual(withSharedDetails.map((row) => row.poNumber), ['PO-123', 'PO-123']);

  const withAmount = updateEprCreditPoRows(withSharedDetails, 1, { poAmount: '250' });
  assert.deepEqual(withAmount.map((row) => row.poAmount), ['100', '250']);
});

test('service dropdown selections group PO rows against the matching service', () => {
  const services = [
    { assignedServiceId: 'service-1', servicesOffered: 'Category 1 – EOL' },
    { assignedServiceId: 'service-2', servicesOffered: 'Category 1 – Recycling' }
  ];
  const result = groupEprCreditPoRowsByService([
    { assignedServiceId: 'service-2', poAmount: '200' },
    { assignedServiceId: 'service-1', poAmount: '100' }
  ], services);

  assert.equal(result.error, '');
  assert.deepEqual(result.groups.map((group) => [group.service.servicesOffered, group.rows[0].poAmount]), [
    ['Category 1 – EOL', '100'],
    ['Category 1 – Recycling', '200']
  ]);
});

test('changing a PO row service updates its linked quotation and service labels', () => {
  const dialog = {
    quotationSent: 'yes',
    eprCreditServiceOptions: [
      { assignedServiceId: 'service-1', servicesOffered: 'Registration', firstAnnualReturnYearApplicable: '2025-26' },
      { assignedServiceId: 'service-2', servicesOffered: 'Recycling', firstAnnualReturnYearApplicable: '2025-26' }
    ],
    crmPoYearRows: [
      { assignedServiceId: 'service-1', quotationId: 'quote-1', quotationBasicAmount: 10 },
      { assignedServiceId: 'service-2', quotationId: 'quote-2', quotationBasicAmount: 20 }
    ],
    poYearRows: [
      { assignedServiceId: 'service-1', poNumber: 'PO-1', poAmount: '100', services: ['Registration'] },
      { assignedServiceId: 'service-2', poNumber: 'PO-1', poAmount: '200', services: ['Recycling'] }
    ]
  };

  const updated = selectEprCreditPoService(dialog, 0, 'service-2');
  assert.equal(updated.poYearRows[0].assignedServiceId, 'service-2');
  assert.deepEqual(updated.poYearRows[0].services, ['Recycling']);
  assert.equal(updated.poYearRows[0].quotationId, 'quote-2');
  assert.equal(updated.poYearRows[0].poNumber, 'PO-1');
  assert.equal(updated.poYearRows[0].poAmount, '100');
  assert.equal(dialog.poYearRows[0].assignedServiceId, 'service-1');
});

test('service grouping requires every service exactly once', () => {
  const services = [{ assignedServiceId: 'service-1' }, { assignedServiceId: 'service-2' }];
  assert.match(groupEprCreditPoRowsByService([{ assignedServiceId: 'service-1' }], services).error, /every selected/i);
  assert.match(groupEprCreditPoRowsByService([
    { assignedServiceId: 'service-1' },
    { assignedServiceId: 'service-1' }
  ], services).error, /only once/i);
  assert.match(groupEprCreditPoRowsByService([
    { assignedServiceId: 'other-service' },
    { assignedServiceId: 'service-2' }
  ], services).error, /valid EPR Credit service/i);
});
