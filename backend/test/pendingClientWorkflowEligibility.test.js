const test = require('node:test');
const assert = require('node:assert/strict');
const clientController = require('../src/controllers/clientController');

const ready = (overrides = {}) => ({
  assignedServiceId: 'service-1',
  selectedLead: {
    assignments: [{
      assignedServiceId: 'service-1',
      poStatus: 'received',
      poApprovalStatus: 'APPROVED',
      closedAt: '2026-10-26T07:00:00.000Z',
      assignedTo: 'manager-1',
      assignedStaff: 'staff-1',
      ...overrides
    }]
  }
});

test('Pending Clients includes only a closed approved PO assigned by manager to staff', () => {
  const { pendingClientWorkflowReady } = clientController.__test;
  assert.equal(pendingClientWorkflowReady(ready()), true);
  assert.equal(pendingClientWorkflowReady(ready({ poStatus: 'provisional' })), false);
  assert.equal(pendingClientWorkflowReady(ready({ poApprovalStatus: 'PENDING' })), false);
  assert.equal(pendingClientWorkflowReady(ready({ closedAt: '', closedBy: '', closureFinalizedByManager: false })), false);
  assert.equal(pendingClientWorkflowReady(ready({ assignedTo: '' })), false);
  assert.equal(pendingClientWorkflowReady(ready({ assignedStaff: '' })), false);
});

test('Pending Clients matches the exact assigned service instead of another ready service', () => {
  const { pendingClientWorkflowReady } = clientController.__test;
  const client = ready();
  client.selectedLead.assignments.unshift({
    assignedServiceId: 'service-2', poStatus: 'received', poApprovalStatus: 'APPROVED',
    closedAt: '2026-10-26T07:00:00.000Z', assignedTo: 'manager-1', assignedStaff: 'staff-1'
  });
  client.selectedLead.assignments[1].assignedStaff = '';
  assert.equal(pendingClientWorkflowReady(client), false);
});

test('Pending Clients displays staff and service from the exact manager assignment', () => {
  const { pendingClientDisplayContext } = clientController.__test;
  const client = ready();
  client.selectedLead.assignments.push({
    assignedServiceId: 'service-2',
    assignedStaff: 'staff-2',
    assignedStaffText: 'Another Staff Member'
  });
  client.selectedLead.serviceSelections = [
    { assignedServiceId: 'service-1', servicesOffered: 'New Registration' },
    { assignedServiceId: 'service-2', servicesOffered: 'Annual Return' }
  ];
  client.data = {
    assignedServiceId: 'service-1',
    basic: {}
  };

  assert.deepEqual(
    pendingClientDisplayContext(client, new Map([['staff-1', 'Shubham Desai'], ['staff-2', 'Another Staff Member']])),
    { assignedStaff: 'Shubham Desai', serviceOffered: 'New Registration' }
  );
  assert.deepEqual(
    pendingClientDisplayContext({ ...client, assignedServiceId: 'service-2' }, new Map([['staff-2', 'Another Staff Member']])),
    { assignedStaff: 'Another Staff Member', serviceOffered: 'Annual Return' }
  );
});
