const test = require('node:test');
const assert = require('node:assert/strict');
const { reassignPurchaseOrderAssignments, poProofManifest } = require('../src/services/purchaseOrderReassignment');

test('moves a saved PO and its approved closure state to the selected service', () => {
  const assignments = [
    {
      assignedServiceId: 'importer-service', poStatus: 'received', poApprovalStatus: 'APPROVED',
      assignedTo: 'manager-1', assignedToText: 'TUSHAR GAWAS', assignedToEmail: 'pibo.operations@ananttattva.com',
      assignedStaff: 'staff-1', assignedStaffText: 'TUSHAR GAWAS', assignedStaffEmail: 'pibo.operations@ananttattva.com',
      closedBy: 'user-1', closedByText: 'Admin', closedAt: '2026-10-10T13:15:00.000Z',
      poYearRows: [{ poNumber: '8000519922', poAmount: 75000, poFileUrl: 'https://files.example/po.pdf' }]
    },
    { assignedServiceId: 'brand-owner-service', poYearRows: [] }
  ];
  const serviceSelections = [
    { assignedServiceId: 'importer-service', subApplicantType: 'Importer' },
    { assignedServiceId: 'brand-owner-service', subApplicantType: 'Brand Owner' }
  ];

  const result = reassignPurchaseOrderAssignments({ assignments, serviceSelections, poNumber: '8000519922', targetAssignmentIndex: 1 });

  assert.equal(result.sourceIndex, 0);
  assert.equal(result.targetIndex, 1);
  assert.equal(result.targetService.subApplicantType, 'Brand Owner');
  assert.deepEqual(result.nextAssignments[0].poYearRows, []);
  assert.equal(result.nextAssignments[0].poStatus, '');
  assert.equal(result.nextAssignments[1].poYearRows[0].poNumber, '8000519922');
  assert.equal(result.nextAssignments[1].poApprovalStatus, 'APPROVED');
  assert.equal(result.nextAssignments[1].closedBy, 'user-1');
  assert.equal(result.nextAssignments[1].assignedTo, 'manager-1');
  assert.equal(result.nextAssignments[1].assignedToText, 'TUSHAR GAWAS');
  assert.equal(result.nextAssignments[1].assignedToEmail, 'pibo.operations@ananttattva.com');
  assert.equal(result.nextAssignments[1].assignedStaff, 'staff-1');
  assert.equal(result.nextAssignments[0].assignedTo, 'manager-1');
});

test('preserves an existing destination assignment while moving the PO', () => {
  const result = reassignPurchaseOrderAssignments({
    assignments: [
      { assignedTo: 'source-manager', assignedStaff: 'source-staff', poYearRows: [{ poNumber: 'PO-2' }] },
      { assignedTo: 'destination-manager', assignedStaff: 'destination-staff', poYearRows: [] }
    ],
    poNumber: 'PO-2',
    targetAssignmentIndex: 1
  });

  assert.equal(result.nextAssignments[1].assignedTo, 'destination-manager');
  assert.equal(result.nextAssignments[1].assignedStaff, 'destination-staff');
});

test('rejects a move when the PO is already on the destination service', () => {
  assert.throws(() => reassignPurchaseOrderAssignments({
    assignments: [{ poYearRows: [] }, { poYearRows: [{ poNumber: 'PO-1' }] }],
    poNumber: 'PO-1',
    targetAssignmentIndex: 1
  }), /already assigned/);
});

test('creates an approval proof manifest without dropping proof metadata', () => {
  assert.deepEqual(poProofManifest([{ poNumber: 'PO-1', poFileUrl: 'https://files.example/po.pdf', poFileName: 'po.pdf', poFileSize: 42 }]), [{
    rowIndex: 0, poNumber: 'PO-1', poFileUrl: 'https://files.example/po.pdf', poFileName: 'po.pdf', poFileMimeType: '', poFileSize: 42
  }]);
});
