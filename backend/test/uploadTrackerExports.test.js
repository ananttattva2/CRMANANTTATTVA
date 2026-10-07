const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../../frontend/src/utils/uploadTrackerExports.mjs');
const client = (id, name, complete = false) => ({ clientId: id, clientName: name, slaReceived: complete,
  purchase: Array(8).fill(complete ? 'complete' : 'pending'), sales: Array(8).fill('pending') });
const users = [{ userName: 'Saurabh', clients: [client('a', '=Company', true), client('b', 'Second company')] },
  { userName: 'Sonal', clients: [client('c', 'Second company')] }];

test('export summary and detail columns include separate reviews, all user-company allocations and grand totals', async () => {
  const { buildUploadTrackerExport } = await helpers;
  const data = buildUploadTrackerExport(users);
  assert.equal(data.summaryHeaders.length, 20);
  assert.equal(data.clientHeaders.length, 19);
  assert.equal(data.summary.length, 3);
  assert.equal(data.clients.length, 3);
  assert.deepEqual(data.summary.at(-1).slice(0, 4), ['Grand Total', 3, 1, 2]);
  assert.equal(data.summary[0][10], '1 / 2\n1 pending');
  assert.equal(data.clients[0][1], "'=Company");
  assert.equal(data.clients[0][9], 'Approved');
  assert.equal(data.clients[0][17], 'Pending');
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
  assert.equal(summary.getCell('E4').value, 'Purchase');
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
  assert.equal(pdf.lastAutoTable.columns.length, 11);
  assert.equal(pdf.lastAutoTable.body.at(-1).cells[1].text[0], 'Company 59');
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const summary = await createUploadTrackerPdf(users, '2025-26');
  assert.equal(summary.lastAutoTable.body.at(-1).cells[0].text[0], 'Grand Total');
  assert.equal(summary.lastAutoTable.columns.length, 12);
});
