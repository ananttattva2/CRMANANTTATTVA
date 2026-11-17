const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../../frontend/src/utils/uploadTrackerExports.mjs');
const client = (id, name, complete = false) => ({ clientId: id, clientName: name,
  purchase: Array(9).fill(complete ? 'complete' : 'pending'), sales: Array(9).fill(complete ? 'complete' : 'pending') });
const users = [{ userName: 'Saurabh', clients: [client('a', '=Company', true), client('b', 'Second company')] },
  { userName: 'Sonal', clients: [client('c', 'Second company')] }];

test('export summary and detail columns include separate reviews, all user-company allocations and grand totals', async () => {
  const { buildUploadTrackerExport } = await helpers;
  const data = buildUploadTrackerExport(users);
  assert.equal(data.summaryHeaders.length, 21);
  assert.equal(data.clientHeaders.length, 21);
  assert.equal(data.summary.length, 3);
  assert.equal(data.clients.length, 3);
  assert.deepEqual(data.summary.at(-1).slice(0, 3), ['Grand Total', 3, '1 / 3']);
  assert.equal(data.summary[0][10], '1\n1 pending');
  assert.equal(data.clients[0][1], "'=Company");
  assert.equal(data.clients[0][2], 'Completed');
  assert.equal(data.clients[0][10], 'Approved');
  assert.equal(data.clients[0][19], 'Approved');
  assert.equal(buildUploadTrackerExport([{ ...users[0], clients: [users[0].clients[0]] }]).summary[0][1], 1);
});

test('Excel export creates a readable workbook with freeze panes, grouped headings and every detail row', async () => {
  const { createUploadTrackerWorkbook } = await helpers;
  const workbook = await createUploadTrackerWorkbook(users, '2025-26');
  const bytes = await workbook.xlsx.writeBuffer();
  const restored = new workbook.constructor();
  await restored.xlsx.load(bytes);
  const summary = restored.getWorksheet('User Summary');
  const details = restored.getWorksheet('Client Details');
  assert.equal(summary.getCell('A8').value, 'Grand Total');
  assert.equal(summary.getCell('B8').value, 3);
  assert.equal(summary.getCell('D4').value, 'Purchase');
  assert.equal(summary.getCell('M4').value, 'Sales');
  assert.equal(details.getCell('B6').value, "'=Company");
  assert.equal(details.rowCount, 8);
  assert.equal(details.views[0].ySplit, 5);
  assert.equal(details.pageSetup.printTitlesRow, '4:5');
  assert.equal(summary.getCell('A8').font.bold, true);
});

test('PDF exports paginate full user lists and retain the last client and both review columns', async () => {
  const { createUploadTrackerPdf } = await helpers;
  const many = [{ userName: 'Saurabh', clients: Array.from({ length: 60 }, (_, index) => client(String(index), `Company ${index}`)) }];
  const pdf = await createUploadTrackerPdf(many, '2025-26', { scope: 'Saurabh', clientMode: true });
  assert.ok(pdf.getNumberOfPages() >= 4);
  assert.equal(pdf.lastAutoTable.body.length, 60);
  assert.equal(pdf.lastAutoTable.columns.length, 12);
  assert.equal(pdf.lastAutoTable.body.at(-1).cells[1].text[0], 'Company 59');
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const summary = await createUploadTrackerPdf(users, '2025-26');
  assert.equal(summary.lastAutoTable.body.at(-1).cells[0].text[0], 'Grand Total');
  assert.equal(summary.lastAutoTable.columns.length, 12);
});

test('a client counts once only after every Purchase and Sales stage is complete', async () => {
  const { countCompletedUploadTrackerClients, isUploadTrackerClientComplete } = await import('../../frontend/src/utils/uploadTrackerCompletion.mjs');
  const done = client('done', 'Atul Ltd', true);
  const incomplete = client('open', 'Open Ltd', true);
  incomplete.sales[4] = 'progress';
  assert.equal(isUploadTrackerClientComplete(done), true);
  assert.equal(isUploadTrackerClientComplete(incomplete), false);
  assert.equal(countCompletedUploadTrackerClients([done, incomplete]), 1);
});
