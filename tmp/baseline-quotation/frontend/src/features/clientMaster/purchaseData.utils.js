import * as XLSX from 'xlsx';

const LEGACY_BASE_HEADERS = ['Financial Year', 'Name of Entity', 'Registration Type', 'GSTIN', 'Invoice Number', 'Invoice Date', 'Category of Plastic', 'Plastic Material Type', 'Quantity (TPA)', 'GST Paid', 'State', 'Remarks'];
const LEGACY_PORTAL_HEADERS = ['Financial Year', 'Name of Entity', 'Registration Type', 'GSTIN', 'Portal Reference Number', 'Category of Plastic', 'Plastic Material Type', 'Total Plastic Qty (Tons)', 'GST Paid', 'Upload Status', 'Upload Date', 'Remarks'];
const PURCHASE_BASE_HEADERS = ['Financial Year', 'Name of Entity', 'Registration Type', 'GSTIN', 'Invoice Number', 'Invoice Date', 'Category of Plastic', 'Plastic Material Type', 'Qty. of Plastic (MT)', 'Total Invoice Value', 'State', 'Remarks'];
const PURCHASE_PORTAL_HEADERS = ['Financial Year', 'Name of Entity', 'Registration Type', 'GSTIN', 'Portal Reference Number', 'Category of Plastic', 'Plastic Material Type', 'Total Plastic Quantity', 'Total Invoice Value', 'Upload Status', 'Upload Date', 'Remarks'];

const normalizeHeader = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const FINANCIAL_YEAR_HEADERS = new Set(['financialyear', 'financialyr', 'fy', 'year']);

export function getPurchaseFinancialYearMismatch(rows, selectedFinancialYear) {
  const selected = String(selectedFinancialYear || '').trim();
  if (!selected || !Array.isArray(rows) || !rows.length) return null;
  const financialYearHeader = Object.keys(rows[0] || {}).find((header) => FINANCIAL_YEAR_HEADERS.has(normalizeHeader(header)));
  if (!financialYearHeader) return null;
  const workbookYears = [...new Set(rows.map((row) => String(row?.[financialYearHeader] ?? '').trim()).filter(Boolean))];
  const mismatchedYears = workbookYears.filter((year) => year !== selected);
  if (!mismatchedYears.length) return null;
  return {
    selectedFinancialYear: selected,
    workbookFinancialYears: workbookYears,
    message: `This Annual Return workspace is FY ${selected}, but the Excel file contains FY ${mismatchedYears.join(', ')}. Open the matching Annual Return year or change the Excel Financial Year column to ${selected}.`
  };
}

export async function readPurchaseWorkbook(file, source) {
  if (!file) throw new Error('Select an Excel file first.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Excel file must be 12 MB or smaller.');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
    const quantityHeaders = source === 'base'
      ? ['qtyofplasticmt', 'quantitymt', 'qtymt', 'quantitytpa', 'purchasequantity', 'plasticquantitytpa', 'totalquantitytpa']
      : ['totalplasticquantity', 'totalplasticquantitymt', 'totalplasticqtytons', 'totalplasticqtyton', 'totalplasticqty', 'plasticquantitytons', 'uploadedquantity', 'quantitytpa', 'quantitymt', 'qtymt'];
    const headerIndex = matrix.findIndex((row) => Array.isArray(row) && row.some((cell) => quantityHeaders.includes(normalizeHeader(cell))));
    if (headerIndex < 0) continue;
    const headers = matrix[headerIndex].map((cell, index) => String(cell || `Column ${index + 1}`).trim());
    const rows = matrix.slice(headerIndex + 1)
      .filter((row) => row.some((cell) => String(cell ?? '').trim()))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
    if (!rows.length) throw new Error('The selected worksheet contains headers but no data rows.');
    if (rows.length > 10000) throw new Error('A maximum of 10,000 rows is supported per import.');
    return { sheetName, headerRowNumber: headerIndex + 1, rows, preview: rows.slice(0, 8), headers };
  }
  throw new Error(source === 'base' ? 'Could not find the required Qty. of Plastic (MT) header.' : 'Could not find the required Total Plastic Quantity header.');
}

export function downloadPurchaseTemplate(source, financialYear) {
  return downloadDataTemplate(source, financialYear, 'purchase');
}

export function downloadDataTemplate(source, financialYear, moduleName = 'purchase') {
  const moduleLabel = moduleName === 'sales' ? 'Sales' : 'Purchase';
  const isPurchase = moduleName === 'purchase';
  const headers = source === 'base'
    ? (isPurchase ? PURCHASE_BASE_HEADERS : LEGACY_BASE_HEADERS)
    : (isPurchase ? PURCHASE_PORTAL_HEADERS : LEGACY_PORTAL_HEADERS);
  const example = source === 'base'
    ? [financialYear, 'ABC RECYCLERS PRIVATE LIMITED', 'Registered', '27ABCDE1234F1Z5', 'INV-1001', '01-04-2025', 'Cat-I', 'PET', 12.5, 2250, 'Maharashtra', 'Example only']
    : [financialYear, 'ABC RECYCLERS PRIVATE LIMITED', 'Registered', '27ABCDE1234F1Z5', 'PORTAL-1001', 'Cat-I', 'PET', 12.5, 2250, 'Uploaded', '05-04-2025', 'Example only'];
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, example]);
  dataSheet['!cols'] = headers.map((header) => ({ wch: Math.max(16, header.length + 2) }));
  const instructions = XLSX.utils.aoa_to_sheet([
    [`${moduleLabel} Data Import Instructions`],
    ['Rule', 'Value'],
    ['Financial Year', `Use ${financialYear} on every row`],
    ['Registration Type', 'Registered or Unregistered'],
    ['Category', 'Cat-I, Cat-II, Cat-III or Cat-IV'],
    ['Quantity', 'Non-negative numbers; commas are accepted'],
    ...(isPurchase ? [['System Mapping', source === 'base' ? 'Qty. of Plastic (MT) = Base Qty; Total Invoice Value = Base GST' : 'Total Plastic Quantity = Portal Qty; Total Invoice Value = Portal GST Value']] : []),
    ['Dates', 'DD-MM-YYYY or YYYY-MM-DD'],
    ['Important', 'Do not rename required headers. Remove the example row before upload.']
  ]);
  instructions['!cols'] = [{ wch: 24 }, { wch: 72 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, source === 'base' ? `${moduleLabel} Base Data` : `${moduleLabel} Portal Upload`);
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions');
  XLSX.writeFile(workbook, `${moduleName}-${source}-template-${financialYear}.xlsx`);
}

export function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function formatMetric(value) {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
