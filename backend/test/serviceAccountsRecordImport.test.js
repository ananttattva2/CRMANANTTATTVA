const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../src/controllers/leadController');

const serviceRows = [
  { assignedServiceId: 'service-1', servicesOffered: 'Annual Return Filing', eprCategory: 'EPR - Plastic Waste', applicantType: 'PIBO', piboCategory: 'Producer' },
  { assignedServiceId: 'service-2', servicesOffered: 'New Registration', eprCategory: 'EPR - Plastic Waste', applicantType: 'PIBO', piboCategory: 'Importer' },
  { assignedServiceId: 'service-3', servicesOffered: 'CPCB Account Details Modification', eprCategory: 'EPR - Plastic Waste', applicantType: 'PIBO', piboCategory: 'Brand Owner' }
];

test('maps repeated CRM Lead ID rows sequentially to every saved service', () => {
  const rows = ['ATPL-0384', 'ATPL-0383', 'ATPL-0382'].map((accountsRecordId, index) =>
    _test.normalizeAccountsRecordImportRow({ crmLeadId: 'ATPL-0004', accountsRecordId }, index + 2));
  const mapped = _test.mapAccountsRecordRowsToLead({ _id: 'lead-4', leadCode: 'ATPL-0004', company: 'CCL FOOD AND BEVERAGES PVT LTD', serviceSelections: serviceRows }, rows);

  assert.deepEqual(mapped.map((row) => row.status), ['ready', 'ready', 'ready']);
  assert.deepEqual(mapped.map((row) => row.serviceIndex), [0, 1, 2]);
  assert.deepEqual(mapped.map((row) => row.accountsRecordId), ['ATPL-0384', 'ATPL-0383', 'ATPL-0382']);
});

test('accepts the Lead Number field and full ATPL-LEAD identifier format', () => {
  const normalized = _test.normalizeAccountsRecordImportRow({
    leadNumber: 'ATPL-LEAD-0004',
    accountsRecordId: 'ATPL-LEAD-0384'
  }, 2);

  assert.equal(normalized.crmLeadId, 'ATPL-LEAD-0004');
  assert.equal(normalized.accountsRecordId, 'ATPL-LEAD-0384');
});

test('uses optional service details for an exact service match', () => {
  const row = _test.normalizeAccountsRecordImportRow({
    crmLeadId: 'ATPL-0004',
    accountsRecordId: 'ATPL-0383',
    serviceName: 'New Registration',
    subApplicantType: 'Importer'
  }, 2);
  const [mapped] = _test.mapAccountsRecordRowsToLead({ _id: 'lead-4', company: 'CCL', serviceSelections: serviceRows }, [row]);

  assert.equal(mapped.status, 'ready');
  assert.equal(mapped.serviceIndex, 1);
  assert.equal(mapped.assignedServiceId, 'service-2');
});

test('rejects extra Accounts IDs instead of assigning beyond saved services', () => {
  const rows = ['ATPL-0384', 'ATPL-0383', 'ATPL-0382', 'ATPL-0381'].map((accountsRecordId, index) =>
    _test.normalizeAccountsRecordImportRow({ crmLeadId: 'ATPL-0004', accountsRecordId }, index + 2));
  const mapped = _test.mapAccountsRecordRowsToLead({ _id: 'lead-4', company: 'CCL', serviceSelections: serviceRows }, rows);

  assert.equal(mapped[3].status, 'error');
  assert.match(mapped[3].error, /more Accounts IDs than this lead has services/i);
});

test('rejects ambiguous service descriptions and requests a stable service ID', () => {
  const row = _test.normalizeAccountsRecordImportRow({ crmLeadId: 'ATPL-0004', accountsRecordId: 'ATPL-0384', serviceCategory: 'EPR - Plastic Waste' }, 2);
  const [mapped] = _test.mapAccountsRecordRowsToLead({ _id: 'lead-4', company: 'CCL', serviceSelections: serviceRows }, [row]);

  assert.equal(mapped.status, 'error');
  assert.match(mapped.error, /more than one service matches/i);
});
