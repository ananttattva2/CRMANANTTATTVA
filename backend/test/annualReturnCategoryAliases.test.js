const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeManagerStaffAllocations } = require('../src/services/managerStaffAllocations');

test('legacy waste category aliases recover closed annual services with stale registration master IDs', () => {
  const { buildRecords } = require('../src/services/annualReturnOperationsDashboard');
  const service = { assignedServiceId: 'annual-current', eprCategory: 'EPR - Plastic Waste', subApplicantType: 'Importer', applicantType: 'PIBO', servicesOffered: 'Annual Return Filling', plantUnit: 'Unit 1' };
  const lead = { _id: 'oswal', company: 'OSWAL CHEMICALS', serviceSelections: [service, { ...service, assignedServiceId: 'credit', servicesOffered: 'Category 2 Recycling' }], assignments: [{ assignedServiceId: 'annual-current', closedAt: '2026-11-01', assignedTo: 'manager', assignedStaff: 'staff', poStatus: 'received', poYearRows: [{ poNumber: 'PO1', annualReturnYear: '2025-26', services: ['Annual Return Filling'] }] }] };
  const registration = { _id: 'old-registration', selectedLead: lead, assignedServiceId: 'obsolete-registration', workflowStatus: 'submitted', data: { basic: { piboCategory: 'Importer', eprCategory: 'EPR-PLASTIC' }, cpcb: { status: 'Approved' } } };
  const draft = { _id: 'annual-draft', selectedLead: lead, assignedServiceId: 'annual-current', workflowStatus: 'draft', data: { basic: { piboCategory: 'Importer', eprCategory: 'EPR - Plastic Waste', servicesOffered: 'Annual Return Filling', plantUnit: 'Unit 1' }, cpcb: { status: '' } } };
  const users = [{ _id: 'staff', name: 'Assigned Staff', role: 'operation' }];
  const merged = mergeManagerStaffAllocations([registration, draft], [lead]);
  const rows = buildRecords({ clients: merged, users });
  assert.equal(rows.length, 1); assert.equal(rows[0].company, 'OSWAL CHEMICALS'); assert.deepEqual(rows[0].years, ['2025-26']); assert.equal(rows[0].assignedUser, 'Assigned Staff');
  const differentApplicant = { ...registration, data: { ...registration.data, basic: { ...registration.data.basic, piboCategory: 'Producer' } } };
  assert.equal(buildRecords({ clients: mergeManagerStaffAllocations([differentApplicant, draft], [lead]), users }).length, 0);
  for (const basic of [{ ...registration.data.basic, plantUnit: 'Unit 2' }, { ...registration.data.basic, eprCategory: 'EPR - Battery Waste' }]) {
    const unrelated = { ...registration, data: { ...registration.data, basic } };
    assert.equal(buildRecords({ clients: mergeManagerStaffAllocations([unrelated, draft], [lead]), users }).length, 0);
  }
});
