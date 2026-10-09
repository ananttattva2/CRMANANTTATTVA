const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUploadTracker, stageState } = require('../src/services/clientUploadTracker');

test('manager and compliance review stages use independent saved verification statuses', () => {
  assert.equal(stageState({ managerVerificationStatus: 'Approved', complianceVerificationStatus: 'Pending' }, 'Manager Review'), 'complete');
  assert.equal(stageState({ managerVerificationStatus: 'Approved', complianceVerificationStatus: 'Pending' }, 'Compliance Review'), 'pending');
  assert.equal(stageState({ complianceVerificationStatus: 'Approved' }, 'Compliance Review'), 'complete');
  for (const status of [undefined, 'Not Submitted', 'Not Ready', 'Pending', 'Rejected']) {
    assert.equal(stageState({ managerVerificationStatus: status }, 'Manager Review'), 'pending');
    assert.equal(stageState({ complianceVerificationStatus: status }, 'Compliance Review'), 'pending');
  }
});

test('CCL SLA receipt survives blank sibling services and review counts stay unique per company', () => {
  const users = [{ _id: 'shubham', name: 'SHUBHAM DESAI', role: 'operation' }];
  const clients = ['producer', 'importer'].map(_id => ({ _id, selectedLead: { assignedStaff: 'shubham', company: 'CCL FOOD AND BEVERAGES PVT LTD' }, sla: _id === 'producer' ? { status: 'Yes' } : {} }));
  const purchases = clients.map(client => ({ clientId: client._id, managerVerificationStatus: 'Approved', complianceVerificationStatus: client._id === 'producer' ? 'Approved' : 'Pending' }));
  const [group] = buildUploadTracker(clients, users, purchases, [{ clientId: 'producer', managerVerificationStatus: 'Approved' }]);
  assert.equal(group.clients.length, 1);
  assert.equal(group.clients[0].slaReceived, true);
  assert.equal(group.slaReceived, 1);
  assert.equal(group.slaNotReceived, 0);
  assert.equal(group.purchase[6].complete, 1);
  assert.equal(group.purchase[7].pending, 1);
  assert.equal(group.sales[6].pending, 1);
  assert.equal(group.sales[6].progress, 0);
  assert.equal(group.clients[0].purchase[6], 'complete');
  assert.equal(group.clients[0].purchase[7], 'pending');
});
const { buildDataWorkflowEmail } = require('../src/services/dataWorkflowEmail');
test('tracker counts allocated clients once and separates Purchase and Sales stages', () => {
  const clients = [{ _id:'c1', selectedLead:{assignedStaff:'u1'}, createdBy:'admin', adminControls:{assignedTo:'u1'}, sla:{status:'Yes'}, data:{basic:{clientLegalName:'Alpha'}} },{ _id:'c2', selectedLead:{assignedStaffText:'First User'}, createdBy:'u2', data:{importMeta:{assignedTo:'First User'}} }];
  const users = [{_id:'u1',name:'First User',role:'operations'}, {_id:'u2',name:'Second User',role:'operations'}];
  const purchases = [{clientId:'c1',checklist:[{particular:'Data Explained',yesNo:'Yes'}],baseUpload:{importStatus:'Imported'},portalUpload:{importStatus:'Imported'}}];
  const result = buildUploadTracker(clients,users,purchases,[]);
  assert.equal(result.length,1); assert.equal(result[0].clients.length,2);
  assert.equal(result[0].slaReceived,1); assert.equal(result[0].slaNotReceived,1);
  assert.equal(result[0].purchase[0].complete,1); assert.equal(result[0].purchase[5].complete,1);
  assert.equal(result[0].sales[5].pending,2);
  assert.equal(result[0].purchase[0].pending,1);
});
test('partial data and single import stay in progress; empty rows stay pending', () => {
  assert.equal(stageState({checklist:[{particular:'Received from client',yesNo:'Yes',partialDataReceived:true}]},'Received from client'),'progress');
  assert.equal(stageState({baseUpload:{importStatus:'Imported'}},'Upload Complete'),'progress');
  assert.equal(stageState({},'Data Format Sent'),'pending');
});
test('workflow email escapes user content and shows readable file names', () => {
  const html = buildDataWorkflowEmail({title:'Review <script>',moduleName:'Purchase',clientName:'A & B',financialYear:'2025-26',actorName:'Uploader',recipientName:'Manager',stage:'manager_pending',record:{baseUpload:{name:'storage-id.xlsx',originalName:'Purchase report.xlsx',importStatus:'Imported',importedRowCount:5,totalQuantity:12}}});
  assert.ok(html.includes('A &amp; B')); assert.ok(html.includes('Review &lt;script&gt;'));
  assert.ok(html.includes('Purchase report.xlsx')); assert.ok(!html.includes('storage-id.xlsx'));
  assert.ok(html.includes('automatically submitted')); assert.ok(html.includes('Review data in CRM'));
});

test('CCL permanent Operations owner wins over Tushar admin metadata', () => {
  const users = [{_id:'shubham',name:'SHUBHAM DESAI',role:'operation'}, {_id:'tushar',name:'TUSHAR GAWAS',role:'manager'}, {_id:'sales',name:'Sales User',role:'sales'}];
  const ccl = {_id:'ccl',createdBy:'tushar',adminControls:{assignedTo:'tushar'},selectedLead:{assignedStaff:'shubham'},data:{basic:{clientLegalName:'CCL FOOD AND BEVERAGES PVT LTD'}}};
  const own = {_id:'own',selectedLead:{assignedStaff:'tushar'}};
  const sales = {_id:'salesclient',adminControls:{assignedTo:'sales'}};
  const result = buildUploadTracker([ccl,own,sales,ccl],users,[{clientId:'ccl',baseUpload:{importStatus:'Imported'},portalUpload:{importStatus:'Imported'}}],[]);
  assert.deepEqual(result.map(row => row.userId),['shubham','tushar']);
  assert.equal(result[0].clients.length,1); assert.equal(result[0].clients[0].clientId,'ccl');
  assert.equal(result[1].clients[0].clientId,'own'); assert.equal(result[1].purchase[5].complete,0);
  assert.equal(buildUploadTracker([ccl],[users[1]],[],[])[0].clients.length,0);
});
test('service allocation metadata alone is excluded and permanent snapshot assignments are respected', () => {
  const users = [{_id:'s',name:'Shubham',roles:['Operations']}, {_id:'t',name:'Tushar',role:'operation'}];
  const clients = [{_id:'a',adminControls:{assignedTo:'t'},serviceAllocations:{annual:{userId:'s'}}}, {_id:'b',data:{selectedLeadSnapshot:{assignedStaffText:'Shubham'}}}];
  const result = buildUploadTracker(clients,users,[],[]);
  assert.equal(result.length,1); assert.equal(result[0].userId,'s'); assert.equal(result[0].clients.length,1);
});

test('legacy lead assignments without service IDs resolve the consistent permanent owner', () => {
  const clients = [{_id:'ccl',assignedServiceId:'legacy-service',data:{importMeta:{assignedTo:'Tushar'}},selectedLead:{assignments:[{assignedStaff:'s',assignedStaffText:'Shubham'},{assignedStaff:'s',assignedStaffText:'Shubham'}]}}];
  const result = buildUploadTracker(clients,[{_id:'s',name:'Shubham',role:'operation'},{_id:'t',name:'Tushar',role:'manager'}],[],[]);
  assert.equal(result.find(row => row.userId === 's').clients.length,1);
  assert.equal(result.find(row => row.userId === 't').clients.length,0);
});

test('managers appear with their own allocations and zero-count managers remain visible', () => {
  const users = [{_id:'t',name:'TUSHAR GAWAS',role:'manager'}, {_id:'b',name:'SAURABH BHAT',roles:['manager']}, {_id:'s',name:'SHUBHAM DESAI',role:'operation'}];
  const result = buildUploadTracker([{_id:'t-client',selectedLead:{assignedStaff:'t'}},{_id:'s-client',selectedLead:{assignedStaff:'s'}}],users,[],[]);
  assert.equal(result.length,3);
  assert.equal(result.find(row => row.userId === 't').clients[0].clientId,'t-client');
  assert.equal(result.find(row => row.userId === 'b').clients.length,0);
  assert.equal(result.find(row => row.userId === 's').clients[0].clientId,'s-client');
});
