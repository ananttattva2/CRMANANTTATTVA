const assert = require('node:assert/strict');
const test = require('node:test');

const { __test } = require('../src/controllers/clientController');

test('buildClientApprovalPayload preserves full CRM client data', () => {
  const crmClient = {
    _id: 'crm-client-123',
    adminControls: {
      approvalStatus: 'PENDING',
      visibilityStatus: 'LIVE',
      assignedTo: { id: 'user-44', email: '', name: 'SIDDHESH NIKAM' }
    },
    data: {
      basic: {
        clientLegalName: 'Acme Industries',
        piboCategory: 'Producer',
        eprCategory: 'EPR - Plastic Waste',
        firstAnnualReturnYear: '2023'
      },
      registeredAddress: {
        address1: 'Plot 1',
        city: 'Ahmedabad',
        state: 'Gujarat',
        pincode: '380001'
      },
      communicationAddress: {
        address1: 'Office 2',
        city: 'Surat'
      },
      compliance: {
        gst: '24ABCDE1234F1Z5',
        pan: 'ABCDE1234F'
      },
      msmeRows: [{ status: 'Small', udyamNumber: 'UDYAM-GJ-01' }],
      cte: { numberOfPlantsLocations: '2' },
      cpcb: { registrationNumber: 'CPCB-123', loginId: 'portal-user' },
      validation: { quotationNumber: 'Q-101' },
      otp: { mobile: '9999999999' },
      authorised: { name: 'Riya Shah', email: 'riya@example.com' },
      coordinating: { name: 'Dev Patel' },
      importMeta: { uniqueId: 'CRM-001', createdBy: 'CRM User' }
    }
  };

  const result = __test.buildClientApprovalPayload({
    source: 'crm',
    uniqueId: 'CRM-UNIQUE-1',
    sourceClientId: 'source-from-body',
    payload: crmClient
  }, 'APPROVED', 'user-1', 'Approved from test');

  assert.equal(result.adminControls.approvalStatus, 'APPROVED');
  assert.equal(result.adminControls.visibilityStatus, 'LIVE');
  assert.equal(result.adminControls.assignedTo, undefined);
  assert.deepEqual(result.data.basic, crmClient.data.basic);
  assert.equal(result.data.basic.firstAnnualReturnYear, '2023');
  assert.deepEqual(result.data.registeredAddress, crmClient.data.registeredAddress);
  assert.deepEqual(result.data.compliance, crmClient.data.compliance);
  assert.deepEqual(result.data.cpcb, crmClient.data.cpcb);
  assert.deepEqual(result.data.authorised, crmClient.data.authorised);
  assert.deepEqual(result.data.msmeRows, crmClient.data.msmeRows);
  assert.equal(result.data.importMeta.createdBy, 'CRM User');
  assert.equal(result.data.importMeta.assignedTo, 'SIDDHESH NIKAM');
  assert.equal(result.data.importMeta.uniqueId, 'CRM-UNIQUE-1');
  assert.equal(result.data.importMeta.sourceClientId, 'source-from-body');
  assert.equal(result.data.importMeta.approvalOverride, true);
  assert.equal(result.data.approvalMeta.status, 'APPROVED');
  assert.equal(result.data.approvalMeta.source, 'crm');
});

test('approval of an existing Client Master does not mark it as a hidden override', () => {
  const result = __test.buildClientApprovalPayload({
    source: 'crm',
    sourceClientId: 'existing-client-id',
    payload: {
      data: {
        basic: { clientLegalName: 'MANGLAM PLASTICS PVT LTD' },
        importMeta: { approvalOverride: true }
      }
    }
  }, 'APPROVED', 'reviewer-1', 'Approved', { approvalOverride: false });

  assert.equal(result.data.importMeta.approvalOverride, false);
});
