// Excel cells receive literal values, so user notes are never interpreted as formulas.
export async function createLeadReviewWorkbook(tables, filters = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CRM';
  for (const { name, headers, rows } of tables) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(headers);
    rows.forEach(row => sheet.addRow(row));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
    sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; });
    sheet.columns.forEach((column, index) => { column.width = /note|company/i.test(headers[index]) ? 48 : 24; column.alignment = { vertical: 'top', wrapText: true }; });
  }
  const sheet = workbook.addWorksheet('Filters');
  sheet.addRows([['Filter', 'Value'], ...Object.entries(filters).map(([key, value]) => [key, String(value || 'All')])]);
  sheet.columns = [{ width: 26 }, { width: 60 }];
  return workbook;
}
export async function downloadLeadReviewExcel(tables, filters, filename) {
  const workbook = await createLeadReviewWorkbook(tables, filters);
  const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url; link.download = `${filename}.xlsx`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
