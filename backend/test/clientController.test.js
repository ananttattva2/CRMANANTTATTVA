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

test('approval decision preserves newer live Client Master data instead of restoring its old snapshot', () => {
  const currentData = {
    companyOverview: { companyName: 'MANGLAM PLASTICS PVT LTD', companySummary: 'Latest saved summary' },
    basic: { clientLegalName: 'MANGLAM PLASTICS PVT LTD', companyType: 'Private Limited' },
    compliance: { gst: '20AAKFM5259M1Z1' },
    cpcbScreenshots: [{ name: 'Latest CPCB proof.pdf' }]
  };

  const result = __test.applyApprovalDecisionToClientData(
    currentData,
    'PARTIALLY_APPROVED',
    'crm',
    'reviewer-1',
    'Importer requires correction'
  );

  assert.deepEqual(result.companyOverview, currentData.companyOverview);
  assert.deepEqual(result.basic, currentData.basic);
  assert.deepEqual(result.compliance, currentData.compliance);
  assert.deepEqual(result.cpcbScreenshots, currentData.cpcbScreenshots);
  assert.equal(result.approvalMeta.status, 'PARTIALLY_APPROVED');
  assert.equal(result.approvalMeta.remarks, 'Importer requires correction');
});

test('review applicant list merges the same service across financial years and keeps the complete record', () => {
  const services = __test.uniqueClientMasterReviewServices([
    {
      clientMasterId: 'pending-with-data',
      selectedLead: 'lead-67',
      assignedServiceId: 'service-2025',
      leadCode: 'ATPL-LEAD-0067',
      companyName: 'MANGLAM PLASTICS',
      eprCategory: 'EPR - Plastic Waste',
      applicantType: 'PIBO',
      piboCategory: 'Producer',
      servicesOffered: 'Annual Return Filling',
      plantUnit: 'Unit 1',
      financialYear: '2025-26',
      workflowStatus: 'submitted',
      approvalStatus: 'PENDING'
    },
    {
      clientMasterId: 'partial-without-data',
      selectedLead: 'lead-67',
      assignedServiceId: 'service-2026',
      leadCode: 'ATPL-LEAD-0067',
      companyName: 'MANGLAM PLASTICS',
      eprCategory: 'EPR - Plastic Waste',
      applicantType: 'PIBO',
      piboCategory: 'Producer',
      servicesOffered: 'Annual Return Filing',
      plantUnit: '',
      financialYear: '2026-27',
      workflowStatus: 'submitted',
      approvalStatus: 'PARTIALLY_APPROVED'
    }
  ], 'partial-without-data');

  assert.equal(services.length, 1);
  assert.equal(services[0].clientMasterId, 'pending-with-data');
  assert.equal(services[0].plantUnit, 'Unit 1');
  assert.equal(services[0].approvalStatus, 'PENDING');
});

test('review applicant list keeps identical services separate when plant units differ', () => {
  const common = {
    selectedLead: 'lead-67',
    eprCategory: 'EPR - Plastic Waste',
    applicantType: 'PIBO',
    piboCategory: 'Producer',
    servicesOffered: 'Annual Return Filling',
    workflowStatus: 'submitted',
    approvalStatus: 'PENDING'
  };
  const services = __test.uniqueClientMasterReviewServices([
    { ...common, clientMasterId: 'unit-1', assignedServiceId: 'service-1', plantUnit: 'Unit 1' },
    { ...common, clientMasterId: 'unit-2', assignedServiceId: 'service-2', plantUnit: 'Unit 2' }
  ]);

  assert.equal(services.length, 2);
  assert.deepEqual(services.map(item => item.plantUnit).sort(), ['Unit 1', 'Unit 2']);
});

test('review applicant service restores a missing offering from the exact linked Lead service', () => {
  const result = __test.enrichClientMasterReviewServiceFromLead({
    clientMasterId: 'producer-master',
    assignedServiceId: 'producer-registration',
    piboCategory: 'Producer',
    eprCategory: 'EPR - Plastic Waste',
    servicesOffered: ''
  }, {
    serviceSelections: [
      { assignedServiceId: 'producer-registration', subApplicantType: 'Producer', servicesOffered: 'New Registration' },
      { assignedServiceId: 'brand-owner-annual', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling' }
    ]
  });

  assert.equal(result.servicesOffered, 'New Registration');
  assert.equal(result.piboCategory, 'Producer');
});

test('review applicant service never overwrites an offering already saved on Client Master', () => {
  const result = __test.enrichClientMasterReviewServiceFromLead({
    assignedServiceId: 'producer-registration',
    servicesOffered: 'Saved Service'
  }, {
    serviceSelections: [{ assignedServiceId: 'producer-registration', servicesOffered: 'New Registration' }]
  });

  assert.equal(result.servicesOffered, 'Saved Service');
});
