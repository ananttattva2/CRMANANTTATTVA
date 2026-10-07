const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUploadTracker, stageState } = require('../src/services/clientUploadTracker');
const { buildDataWorkflowEmail } = require('../src/services/dataWorkflowEmail');
test('tracker counts allocated clients once and separates Purchase and Sales stages', () => {
  const clients = [{ _id:'c1', createdBy:'admin', adminControls:{assignedTo:'u1'}, sla:{status:'Yes'}, data:{basic:{clientLegalName:'Alpha'}} },{ _id:'c2', createdBy:'u2', data:{importMeta:{assignedTo:'First User'}} }];
  const users = [{_id:'u1',name:'First User'}, {_id:'u2',name:'Second User'}];
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
