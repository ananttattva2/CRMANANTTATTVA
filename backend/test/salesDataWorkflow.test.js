const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SalesData = require('../src/models/SalesData');
const PurchaseData = require('../src/models/PurchaseData');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');

test('Sales Data persists independently from Purchase Data', () => {
  assert.notEqual(SalesData.modelName, PurchaseData.modelName);
  assert.notEqual(SalesData.collection.collectionName, PurchaseData.collection.collectionName);
  assert.ok(SalesData.schema.path('baseUpload'));
  assert.ok(SalesData.schema.path('portalUpload'));
  assert.ok(SalesData.schema.path('managerVerificationStatus'));
  assert.ok(SalesData.schema.path('reviewHistory'));
});

test('Sales routes expose imports, rows, reconciliation and two-level approvals', () => {
  const routes = read('../src/routes/clients.js');
  assert.match(routes, /sales-data\/checklist', requireAuth/);
  assert.match(routes, /sales-data\/screenshots', requireAuth/);
  assert.match(routes, /sales-imports\/:source', requireAuth/);
  assert.match(routes, /sales-data\/rows', requireAuth/);
  assert.match(routes, /sales-reconciliation', requireAuth/);
  assert.match(routes, /sales-data\/manager-review', requireAuth/);
  assert.match(routes, /sales-data\/compliance-review', requireAuth/);
});

test('second Sales Excel import automatically creates Manager review and notification', () => {
  const controller = read('../src/controllers/salesDataController.js');
  const notifications = read('../src/services/salesDataNotifications.js');
  assert.match(controller, /if \(sales\.baseUpload\?\.importStatus === 'Imported' && sales\.portalUpload\?\.importStatus === 'Imported'\) \{[\s\S]*?automaticSubmission = await submitForManager/);
  assert.match(controller, /purchaseReadiness\(sales\)/);
  assert.match(controller, /Automatically submitted after both Sales Excel files were imported/);
  assert.match(controller, /managerVerificationStatus = 'Pending'/);
  assert.match(controller, /managerNotificationCreated/);
  assert.match(notifications, /managerFor\(actor\)/);
  assert.match(notifications, /sales_data_\$\{stage\}/);
});

test('Sales UI provides two templates, preview, reconciliation and approval controls', () => {
  const panel = read('../../frontend/src/features/clientMaster/SalesDataPanel.jsx');
  const checklist = read('../../frontend/src/features/clientMaster/SalesUploadChecklist.jsx');
  const workspace = read('../../frontend/src/features/clientMaster/PurchaseDataWorkspace.jsx');
  assert.match(workspace, /activeTab === 'Sales Data'/);
  assert.match(panel, /downloadDataTemplate\(source, financialYear, 'sales'\)/);
  assert.match(panel, /Sales Base Data/);
  assert.match(panel, /Sales Portal Upload/);
  assert.match(panel, /Manager review starts automatically/);
  assert.match(panel, /Manager Approve/);
  assert.match(panel, /Compliance Approve/);
  assert.match(panel, /salesChecklist/);
  assert.match(panel, /Upload Complete/);
  assert.match(panel, /!canEdit \|\| !uploadUnlocked/);
  assert.match(checklist, /Sales Data Upload Checklist/);
  assert.match(checklist, /partialDataReceived/);
  assert.match(checklist, /completeDataReceived/);
  assert.match(checklist, /disabled=\{!editable \|\| !enabled\}/);
  assert.match(checklist, /const SIMPLE = new Set\(\['Nil Upload', 'Client Approval on data'\]\)/);
});

test('Sales EML and Outlook MSG proofs use the same decoded mail viewer as Purchase', () => {
  const proofController = read('../src/controllers/purchaseProofController.js');
  const panel = read('../../frontend/src/features/clientMaster/SalesDataPanel.jsx');
  const checklist = read('../../frontend/src/features/clientMaster/SalesUploadChecklist.jsx');
  assert.match(proofController, /\['purchase', 'sales'\]\.includes\(section\)/);
  assert.match(proofController, /section === 'sales' \? SalesData : PurchaseData/);
  assert.match(proofController, /'salesData' : 'purchaseData'/);
  assert.match(panel, /form\.append\('section', 'sales'\)/);
  assert.match(panel, /<OutlookMsgViewer file=\{mailPreview\}/);
  assert.match(panel, /data\.salesData/);
  assert.match(checklist, /onPreview=\{onPreview\}/);
});
