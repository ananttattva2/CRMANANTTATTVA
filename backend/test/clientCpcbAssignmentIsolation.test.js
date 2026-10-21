const assert = require('node:assert/strict');
const test = require('node:test');

const { __test } = require('../src/controllers/clientController');

test('CPCB updates preserve data belonging to other assigned services', () => {
  const serviceA = 'service_assignment_001';
  const serviceB = 'service_assignment_002';
  const existing = {
    cpcbDataByAssignedServiceId: {
      [serviceA]: {
        cpcb: { registrationNumber: 'A-REG', remark: 'Annual return' },
        cpcbScreenshots: Array.from({ length: 4 }, (_, index) => ({ documentId: `a-${index}`, assignedServiceId: serviceA }))
      }
    }
  };
  const incoming = {
    cpcbDataByAssignedServiceId: {
      [serviceB]: {
        cpcb: { registrationNumber: 'B-REG', remark: 'Credit procurement' },
        cpcbScreenshots: Array.from({ length: 4 }, (_, index) => ({ documentId: `b-${index}`, assignedServiceId: serviceB }))
      }
    }
  };

  const saved = __test.mergeAssignedServiceCpcbData(existing, incoming);
  assert.deepEqual(saved.cpcbDataByAssignedServiceId[serviceA], existing.cpcbDataByAssignedServiceId[serviceA]);
  assert.deepEqual(saved.cpcbDataByAssignedServiceId[serviceB], incoming.cpcbDataByAssignedServiceId[serviceB]);
});

test('deleting a Service B document cannot delete a Service A document', () => {
  const serviceA = 'service_assignment_001';
  const serviceB = 'service_assignment_002';
  const existing = {
    cpcbDataByAssignedServiceId: {
      [serviceA]: { cpcbScreenshots: [{ documentId: 'a-1', assignedServiceId: serviceA }] },
      [serviceB]: { cpcbScreenshots: [{ documentId: 'b-1', assignedServiceId: serviceB }, { documentId: 'b-2', assignedServiceId: serviceB }] }
    }
  };
  const incoming = {
    cpcbDataByAssignedServiceId: {
      [serviceB]: { cpcbScreenshots: [{ documentId: 'b-2', assignedServiceId: serviceB }] }
    }
  };

  const saved = __test.mergeAssignedServiceCpcbData(existing, incoming);
  assert.deepEqual(saved.cpcbDataByAssignedServiceId[serviceA].cpcbScreenshots, existing.cpcbDataByAssignedServiceId[serviceA].cpcbScreenshots);
  assert.deepEqual(saved.cpcbDataByAssignedServiceId[serviceB].cpcbScreenshots, incoming.cpcbDataByAssignedServiceId[serviceB].cpcbScreenshots);
});

test('a legacy root CPCB edit is persisted into its effective assigned-service scope', () => {
  const existing = {
    cpcb: { status: 'Not Started' },
    cpcbDataByAssignedServiceId: {
      legacyImporter: { cpcb: { status: 'Not Started', registrationNumber: 'REG-1' } }
    }
  };
  const saved = __test.mergeAssignedServiceCpcbData(existing, {
    assignedServiceId: 'legacyImporter',
    cpcb: { status: 'Approved', registrationNumber: 'REG-1' }
  }, 'legacyImporter');
  assert.equal(saved.cpcb.status, 'Approved');
  assert.equal(saved.cpcbDataByAssignedServiceId.legacyImporter.cpcb.status, 'Approved');
  assert.equal(saved.cpcbDataByAssignedServiceId.legacyImporter.cpcb.registrationNumber, 'REG-1');
});

test('an exact Client Master cannot be updated with another assigned service identity', () => {
  const record = {
    selectedLead: '6a7427653e6eb1b90295f6d0',
    assignedServiceId: 'service-brand-owner',
    data: {}
  };

  assert.equal(__test.validateClientMasterIdentity(record, {
    selectedLead: '6a7427653e6eb1b90295f6d0',
    assignedServiceId: 'service-brand-owner'
  }), '');
  assert.equal(__test.validateClientMasterIdentity(record, {
    assignedServiceId: 'service-importer'
  }), 'Assigned service does not match this Client Master record');
});

test('a legacy record may acquire an assigned service id without changing its lead', () => {
  const record = {
    selectedLead: '6a7427653e6eb1b90295f6d0',
    data: { basic: { piboCategory: 'Brand Owner' } }
  };

  assert.equal(__test.validateClientMasterIdentity(record, {
    selectedLead: '6a7427653e6eb1b90295f6d0',
    assignedServiceId: 'service-brand-owner'
  }), '');
});
