const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
test('Excel export preserves every filtered record, numeric counts and literal notes', async () => {
  const { createLeadReviewWorkbook } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/utils/leadReviewExcel.mjs')));
  const rows = Array.from({ length: 41 }, (_, i) => [`LEAD-${i}`, i, i === 0 ? '=SUM(1,2)' : 'Importer + Seller\nCall tomorrow']);
  const workbook = await createLeadReviewWorkbook([
    { name: 'Leads', headers: ['Lead Code', 'Count', 'Note'], rows },
    { name: 'User Summary', headers: ['User', 'Lead'], rows: [['Gaurav', 41]] }
  ], { Type: 'Lead', Search: 'Importer' });
  const buffer = await workbook.xlsx.writeBuffer();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Leads');
  assert.equal(sheet.rowCount, 42);
  assert.equal(sheet.getCell('B42').value, 40);
  assert.equal(sheet.getCell('C2').value, '=SUM(1,2)');
  assert.equal(sheet.getCell('C3').value, 'Importer + Seller\nCall tomorrow');
  assert.equal(workbook.getWorksheet('User Summary').getCell('B2').value, 41);
  assert.equal(workbook.getWorksheet('Filters').getCell('B3').value, 'Importer');
});
