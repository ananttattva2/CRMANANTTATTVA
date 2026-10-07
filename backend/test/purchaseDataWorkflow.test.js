const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PURCHASE_CHECKLIST_PARTICULARS, normalizeEntityName, normalizeMaterial, normalizePurchaseRows, describePurchaseFinancialYearMismatch,
  reconcilePurchaseRows, parseDate, parseNumber, defaultChecklist, purchaseReadiness, calculatePurchaseStatus
} = require('../src/services/purchaseDataService');

const FY = '2025-26';
const baseRow = (overrides = {}) => ({
  'Financial Year': FY, 'Name of Entity': 'ABC Recyclers Private Limited', 'Registration Type': 'Registered',
  GSTIN: '27ABCDE1234F1Z5', 'Invoice Number': 'INV-1', 'Invoice Date': '01-04-2025',
  'Category of Plastic': 'Cat-I', 'Plastic Material Type': 'PET', 'Quantity (TPA)': 10, 'GST Paid': 1800,
  ...overrides
});
const portalRow = (overrides = {}) => ({
  'Financial Year': FY, 'Name of Entity': 'ABC Recyclers Pvt Ltd', 'Registration Type': 'Registered',
  GSTIN: '27ABCDE1234F1Z5', 'Portal Reference Number': 'PR-1', 'Category of Plastic': 'Cat-I',
  'Plastic Material Type': 'Polyethylene Terephthalate', 'Total Plastic Qty (Tons)': 10, 'GST Paid': 1800,
  'Upload Date': '05-04-2025', ...overrides
});
const parsed = (rows, source) => normalizePurchaseRows(rows, source, FY);

test('tracker contains the required rows in order', () => assert.deepEqual(defaultChecklist().map((row) => row.particular), PURCHASE_CHECKLIST_PARTICULARS));
test('default tracker rows start empty and preserve saved evidence', () => {
  const rows = defaultChecklist([{ particular: 'Received from client', yesNo: 'Yes', date: '2025-04-01', files: [{ url: 'https://x.test/a.pdf' }], remarks: 'done' }]);
  assert.equal(rows.find(row => row.particular === 'Received from client').yesNo, 'Yes'); assert.equal(rows.find(row => row.particular === 'Received from client').files.length, 1); assert.equal(rows.find(row => row.particular === 'Data Explained').yesNo, '');
});
test('comma formatted quantities parse as numbers', () => assert.equal(parseNumber('1,234.500'), 1234.5));
test('Excel serial dates are normalized', () => assert.match(parseDate(45748), /^2025-0[34]-\d{2}$/));
test('DD-MM-YYYY dates are normalized', () => assert.equal(parseDate('07-04-2025'), '2025-04-07'));
test('company suffixes normalize for entity matching', () => assert.equal(normalizeEntityName('ABC Recyclers Private Limited'), normalizeEntityName('ABC Recyclers Pvt. Ltd.')));
test('PET long name normalizes to the same material key', () => assert.equal(normalizeMaterial('Polyethylene Terephthalate'), normalizeMaterial('PET')));
test('valid base import accepts rows and totals quantity', () => { const result = parsed([baseRow()], 'base'); assert.equal(result.invalidRowCount, 0); assert.equal(result.totalQuantity, 10); });
test('valid portal import accepts the portal quantity header', () => { const result = parsed([portalRow()], 'portal'); assert.equal(result.invalidRowCount, 0); assert.equal(result.totalQuantity, 10); });
test('missing required headers reject the complete import', () => assert.throws(() => parsed([{ Name: 'ABC' }], 'base'), /Missing required headers/));

test('headers with extra spaces and minor naming variations are mapped', () => {
  const result = parsed([{
    ' Financial Yr ': FY,
    ' Company Name ': 'ABC Recyclers Private Limited',
    ' Type of Registration ': 'Registered',
    ' GST No. ': '27ABCDE1234F1Z5',
    ' Invoice No. ': 'INV-SPACE-1',
    ' Plastic Cat ': 'Cat I',
    ' Plastic Material ': 'PET',
    ' Qty (MT) ': '1,250.500',
    ' Total GST ': '2,250'
  }], 'base');
  assert.equal(result.invalidRowCount, 0);
  assert.equal(result.acceptedRows[0].quantity, 1250.5);
  assert.equal(result.acceptedRows[0].gstPaid, 2250);
});

test('valid rows remain importable when another row is invalid or duplicated', () => {
  const result = parsed([
    baseRow(),
    baseRow({ 'Invoice Number': 'INV-2', 'Quantity (TPA)': 'not-a-number' }),
    baseRow()
  ], 'base');
  assert.equal(result.acceptedRows.length, 1);
  assert.equal(result.invalidRowCount, 1);
  assert.equal(result.duplicateRowCount, 1);
  assert.ok(result.validationErrors.some((error) => error.rowNumber === 3));
});

test('new purchase template headers map to base and portal metrics', () => {
  const { 'Quantity (TPA)': ignoredBaseQty, 'GST Paid': ignoredBaseGst, ...baseInput } = baseRow();
  const { 'Total Plastic Qty (Tons)': ignoredPortalQty, 'GST Paid': ignoredPortalGst, ...portalInput } = portalRow();
  const base = parsed([{ ...baseInput, 'Qty. of Plastic (MT)': 8.25, 'Total Invoice Value': 1485 }], 'base');
  const portal = parsed([{ ...portalInput, 'Total Plastic Quantity': 8.25, 'Total Invoice Value': 1485 }], 'portal');
  assert.equal(base.acceptedRows[0].quantity, 8.25);
  assert.equal(base.acceptedRows[0].gstPaid, 1485);
  assert.equal(portal.acceptedRows[0].quantity, 8.25);
  assert.equal(portal.acceptedRows[0].gstPaid, 1485);
});
test('Total Invoice Value takes priority over a legacy GST column', () => {
  const result = parsed([baseRow({ 'Total Invoice Value': 2250, 'GST Paid': 999 })], 'base');
  assert.equal(result.acceptedRows[0].gstPaid, 2250);
});
test('a missing invoice value column is reported clearly', () => {
  const { 'GST Paid': ignoredGst, ...row } = baseRow();
  assert.throws(() => parsed([row], 'base'), /Total Invoice Value/);
});
test('producer procurement export maps Seller GST and its combined invoice header', () => {
  const { GSTIN: ignoredGstin, 'Invoice Number': ignoredInvoice, 'Invoice Date': ignoredDate, 'Quantity (TPA)': ignoredQuantity, 'GST Paid': ignoredGst, ...row } = baseRow();
  const result = parsed([{
    ...row,
    'Registration Type': 'Producer',
    'Seller GST': '27ABCDE1234F1Z5',
    'Invoice Number/GST E-Invoice Number': 'INV-2026-001',
    Date: '01-09-2026',
    'Qty. of Plastic (MT)': 12.5,
    'Total Invoice Value': 425000
  }], 'base');
  assert.equal(result.acceptedRows.length, 1);
  assert.equal(result.acceptedRows[0].registrationType, 'Registered');
  assert.equal(result.acceptedRows[0].gstin, '27ABCDE1234F1Z5');
  assert.equal(result.acceptedRows[0].invoiceNumber, 'INV-2026-001');
  assert.equal(result.acceptedRows[0].quantity, 12.5);
  assert.equal(result.acceptedRows[0].gstPaid, 425000);
});
test('purchase portal procurement-details export maps its shortened headers', () => {
  const result = parsed([{
    'Sr. No.': '1',
    'Register Type': 'UnRegistered',
    'Entity Type': 'Brand Owner',
    'Entity Name': 'COLMAN POLYCHEM LLP',
    ' State': 'Gujarat',
    'Plastic Type': 'Others',
    'Category Of Plastic': 'Cat-II',
    'Financial Year': FY,
    'Total Plastic Quantity': '3.125',
    'Total Invoice Value': '23,035.50',
    'GST Invoice No': 'CPL_25-26_1827',
    'Seller GST No': '24AARFC6352J1Z5',
    Date: '10/3/2026'
  }], 'portal');
  assert.equal(result.invalidRowCount, 0);
  assert.equal(result.acceptedRows[0].registrationType, 'Unregistered');
  assert.equal(result.acceptedRows[0].materialType, 'Others');
  assert.equal(result.acceptedRows[0].portalReferenceNumber, 'CPL_25-26_1827');
  assert.equal(result.acceptedRows[0].gstin, '24AARFC6352J1Z5');
  assert.equal(result.acceptedRows[0].quantity, 3.125);
  assert.equal(result.acceptedRows[0].gstPaid, 23035.5);
  assert.equal(result.acceptedRows[0].uploadDate, '2026-03-10');
});
test('wrong financial year is a row validation error', () => assert.equal(parsed([baseRow({ 'Financial Year': '2024-25' })], 'base').invalidRowCount, 1));
test('an all-row financial year mismatch returns actionable import guidance', () => {
  const result = parsed([baseRow({ 'Financial Year': '2026-27' })], 'base');
  assert.deepEqual(describePurchaseFinancialYearMismatch(result, FY), {
    selectedFinancialYear: FY,
    workbookFinancialYears: ['2026-27'],
    message: 'This Annual Return workspace is FY 2025-26, but the Excel file contains FY 2026-27. Open the matching Annual Return year or change the Excel Financial Year column to 2025-26.'
  });
});
test('mixed validation failures do not get mislabeled as only a financial year mismatch', () => {
  const result = parsed([baseRow({ 'Financial Year': '2026-27', 'Qty. of Plastic (MT)': 'bad' })], 'base');
  assert.equal(describePurchaseFinancialYearMismatch(result, FY), null);
});
test('malformed financial year is a row validation error', () => assert.equal(parsed([baseRow({ 'Financial Year': '25-26' })], 'base').invalidRowCount, 1));
test('invalid plastic category is rejected', () => assert.equal(parsed([baseRow({ 'Category of Plastic': 'Cat-V' })], 'base').invalidRowCount, 1));
test('negative quantity is rejected', () => assert.equal(parsed([baseRow({ 'Quantity (TPA)': -1 })], 'base').invalidRowCount, 1));
test('non-numeric GST is rejected', () => assert.equal(parsed([baseRow({ 'GST Paid': 'invalid' })], 'base').invalidRowCount, 1));
test('invalid GSTIN is rejected', () => assert.equal(parsed([baseRow({ GSTIN: 'BADGSTIN' })], 'base').invalidRowCount, 1));
test('duplicate rows are isolated from accepted rows', () => { const result = parsed([baseRow(), baseRow()], 'base'); assert.equal(result.duplicateRowCount, 1); assert.equal(result.acceptedRows.length, 1); });
test('zero quantity is accepted with a warning', () => { const result = parsed([baseRow({ 'Quantity (TPA)': 0 })], 'base'); assert.equal(result.warningRowCount, 1); assert.equal(result.invalidRowCount, 0); });
test('registered and unregistered rows remain separate', () => {
  const result = parsed([baseRow(), baseRow({ 'Name of Entity': 'Loose Supplier', GSTIN: '', 'Registration Type': 'Unregistered', 'Invoice Number': 'INV-2' })], 'base');
  const summary = reconcilePurchaseRows(result.acceptedRows, []); assert.equal(summary.entitySummary.Registered.length, 1); assert.equal(summary.entitySummary.Unregistered.length, 1);
});
test('matched uploads reconcile by GSTIN, category and normalized material', () => {
  const summary = reconcilePurchaseRows(parsed([baseRow()], 'base').acceptedRows, parsed([portalRow()], 'portal').acceptedRows);
  assert.equal(summary.totals.result, 'Matched'); assert.equal(summary.blockingIssueCount, 0); assert.equal(summary.matchingEntities, 1);
});
test('missing portal entity is a blocking issue', () => { const summary = reconcilePurchaseRows(parsed([baseRow()], 'base').acceptedRows, []); assert.equal(summary.totals.result, 'Missing on Portal'); assert.ok(summary.blockingIssueCount > 0); });
test('extra portal entity is a blocking issue', () => { const summary = reconcilePurchaseRows([], parsed([portalRow()], 'portal').acceptedRows); assert.equal(summary.totals.result, 'Extra on Portal'); assert.ok(summary.blockingIssueCount > 0); });
test('quantity inside tolerance is matched', () => { const summary = reconcilePurchaseRows(parsed([baseRow()], 'base').acceptedRows, parsed([portalRow({ 'Total Plastic Qty (Tons)': 10.0005 })], 'portal').acceptedRows); assert.equal(summary.totals.result, 'Matched'); });
test('short upload becomes a warning issue', () => { const summary = reconcilePurchaseRows(parsed([baseRow()], 'base').acceptedRows, parsed([portalRow({ 'Total Plastic Qty (Tons)': 9 })], 'portal').acceptedRows); assert.equal(summary.totals.result, 'Short Upload'); assert.equal(summary.warningIssueCount, 1); });
test('GST difference is detected even when quantity matches', () => { const summary = reconcilePurchaseRows(parsed([baseRow()], 'base').acceptedRows, parsed([portalRow({ 'GST Paid': 1700 })], 'portal').acceptedRows); assert.equal(summary.totals.result, 'GST Mismatch'); });
test('normal path is not ready until tracker, proof and both imports exist', () => { const value = { checklist: defaultChecklist() }; assert.equal(purchaseReadiness(value).ready, false); assert.match(purchaseReadiness(value).errors.join(' '), /Upload Complete/); });
test('Nil Upload path requires only Client Approval on data', () => { const checklist = defaultChecklist().map((row) => row.particular === 'Nil Upload' ? { ...row, yesNo: 'Yes' } : row); const readiness = purchaseReadiness({ checklist }); assert.equal(readiness.ready, false); assert.equal(readiness.nilUpload, true); assert.deepEqual(readiness.errors, ['Client Approval on data: status must be Yes.']); });
test('approved Nil Upload bypasses other tracker rows, evidence and both Excel files', () => { const checklist = defaultChecklist().map((row) => row.particular === 'Nil Upload' ? { ...row, yesNo: 'Yes' } : row.particular === 'Client Approval on data' ? { ...row, yesNo: 'Yes', date: '2025-04-10', files: [{ url: 'https://x.test/proof.pdf' }] } : row); assert.equal(purchaseReadiness({ checklist }).ready, true); });
test('fully approved status wins over upload status', () => assert.equal(calculatePurchaseStatus({ complianceVerificationStatus: 'Approved' }), 'Fully Approved'));
test('routes expose import, reconciliation and two-level approvals behind authentication', () => {
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/clients.js'), 'utf8');
  assert.match(routes, /purchase-imports\/:source', requireAuth/); assert.match(routes, /purchase-reconciliation', requireAuth/);
  assert.match(routes, /purchase-data\/manager-review', requireAuth/); assert.match(routes, /purchase-data\/compliance-review', requireAuth/);
});
test('the second valid Excel import automatically submits once and emails the assigned Manager', () => {
  const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/purchaseDataController.js'), 'utf8');
  const notifications = fs.readFileSync(path.resolve(__dirname, '../src/services/purchaseDataNotifications.js'), 'utf8');
  const workspace = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/PurchaseDataWorkspace.jsx'), 'utf8');
  assert.match(controller, /function hasBothExcelImports\(purchase\)/);
  assert.match(controller, /hasBothExcelImports\(purchase\) && readiness\.ready/);
  assert.match(controller, /submitForManagerApproval\(\{ purchase, client, user: req\.user/);
  assert.match(controller, /preventDuplicate: duplicate/);
  assert.match(controller, /managerEmailSent/);
  assert.match(notifications, /Promise\.allSettled\(emailRecipients/);
  assert.match(workspace, /Sent to Manager for approval and email notification delivered/);
});
test('frontend mounts Purchase Data inside Data Compliance and exposes all requested tabs', () => {
  const annual = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/ClientMasterAnnualReturn.jsx'), 'utf8');
  const workspace = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/PurchaseDataWorkspace.jsx'), 'utf8');
  assert.match(annual, /<PurchaseDataWorkspace/);
  ['Purchase Data','Sales Data','Pre Consumer / State / Annual','EPR Target','EPR CREDIT'].forEach((tab) => assert.match(workspace, new RegExp(tab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  assert.doesNotMatch(workspace, /Upload All Screenshot/);
});
test('mandatory status displays date and drag-drop proof validation', () => {
  const workspace = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/PurchaseDataWorkspace.jsx'), 'utf8');
  const dropzone = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/PurchaseProofDropzone.jsx'), 'utf8');
  const checklist = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/SalesUploadChecklist.jsx'), 'utf8');
  assert.match(workspace, /<SalesUploadChecklist/);
  assert.match(checklist, /Date and supporting proof are required\./);
  assert.match(dropzone, /onDrop=/);
  assert.match(dropzone, /window\.addEventListener\('drop', preventFileNavigation\)/);
  assert.match(dropzone, /event\.stopPropagation\(\)/);
  assert.match(dropzone, /Drop files to upload/);
  assert.match(dropzone, /Drag & drop images, PDF, EML or Outlook MSG/);
  assert.match(workspace, /'Content-Type': 'multipart\/form-data'/);
});
test('Outlook MSG proof opens a safe decoded mail viewer with attachments', () => {
  const viewer = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/OutlookMsgViewer.jsx'), 'utf8');
  assert.match(viewer, /import\('@kenjiuno\/msgreader'\)/);
  assert.match(viewer, /getFileData\(\)/);
  assert.match(viewer, /getAttachment\(item\)/);
  assert.match(viewer, /Clean text view/);
  assert.doesNotMatch(viewer, /dangerouslySetInnerHTML/);
});

 test('checkbox values survive normalization and are cleared when a stage is No', () => {
   const rows = defaultChecklist([{ particular: 'Received from client', yesNo: 'Yes', partialDataReceived: true, completeDataReceived: true }, { particular: 'Ready to upload', yesNo: 'No', partialDataReceived: true }]);
   assert.equal(rows.find(row => row.particular === 'Received from client').partialDataReceived, true);
   assert.equal(rows.find(row => row.particular === 'Received from client').completeDataReceived, true);
   assert.equal(rows.find(row => row.particular === 'Ready to upload').partialDataReceived, false);
 });
 test('Nil Upload approval only needs Yes without date or proof', () => {
   const checklist = defaultChecklist([{ particular: 'Nil Upload', yesNo: 'Yes' }, { particular: 'Client Approval on data', yesNo: 'Yes' }]);
   assert.equal(purchaseReadiness({ checklist }).ready, true);
 });
