const { validGst } = require('./invoicePartyDetails');

const MAX_ROWS = 2500;
const NUMBER_PATTERN = /^ATPI\/26-27\/(\d{3})$/;
const existingNumber = /^(?:ATPI|PI)\/26-27\/(\d+)$/i;
const text = value => ['string', 'number'].includes(typeof value) ? String(value).trim() : '';

function importError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function calendarDate(value) {
  const date = new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseHistoricalProformas(rows, cleanPayload) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) {
    throw importError('Upload a workbook with 1 to 2,500 line item rows.');
  }

  const groups = new Map();
  const columns = ['invoiceDate', 'companyName', 'gstNumber', 'addressLine1', 'city', 'state', 'pinCode',
    'quotationNumber', 'poNumber', 'paymentTerms', 'gstRate', 'expectedTotal', 'status'];
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw importError('Invalid invoice row.');
    const rowNumber = Number.isInteger(row.rowNumber) && row.rowNumber >= 2 ? row.rowNumber : index + 2;
    const invalid = message => { throw importError('Row ' + rowNumber + ': ' + message); };
    const fields = Object.fromEntries(columns.map(key => [key, text(row[key])]));
    const serviceCategory = text(row.serviceCategory);
    const description = text(row.description);
    const quantity = text(row.quantity);
    const unitPrice = text(row.unitPrice);
    if (![...Object.values(fields), serviceCategory, description, quantity, unitPrice].some(Boolean)) continue;

    const proformaNumber = text(row.proformaNumber).toUpperCase();
    const sequence = Number(NUMBER_PATTERN.exec(proformaNumber)?.[1]);
    if (!(sequence >= 1 && sequence <= 202)) invalid('Enter a PI number from ATPI/26-27/001 to ATPI/26-27/202.');
    if (!serviceCategory) invalid('Enter a service category for each line item.');
    const unit = Number(quantity || '1');
    const basicAmount = Number(unitPrice);
    if (!Number.isFinite(unit) || unit <= 0 || !unitPrice || !Number.isFinite(basicAmount) || basicAmount < 0 ||
      !Number.isSafeInteger(Math.round(unit * basicAmount * 100))) invalid('Enter a positive quantity and a valid unit price.');
    if ([...Object.values(fields), serviceCategory, description].some(value => value.length > 2000)) {
      invalid('Keep each cell within 2,000 characters.');
    }

    const group = groups.get(proformaNumber) || { fields: {}, items: [], invalid };
    for (const [key, value] of Object.entries(fields)) {
      if (!value) continue;
      if (group.fields[key] && group.fields[key] !== value) invalid('Invoice details conflict with another row for ' + proformaNumber + '.');
      group.fields[key] = value;
    }
    group.items.push({ serviceCategory, servicesOffered: description, unit: String(unit), basicAmount });
    groups.set(proformaNumber, group);
  }
  if (!groups.size) throw importError('Fill at least one invoice and line item in the template.');

  return [...groups].map(([proformaNumber, { fields, items, invalid }]) => {
    const { companyName, invoiceDate, addressLine1, city, state, pinCode, quotationNumber, poNumber, paymentTerms } = fields;
    const gstNumber = (fields.gstNumber || '').toUpperCase();
    const gstRate = Number(fields.gstRate ?? 18);
    const status = (fields.status || 'issued').toLowerCase();
    if (!companyName) invalid('Company Name is required for ' + proformaNumber + '.');
    if (!invoiceDate || !calendarDate(invoiceDate)) invalid('Enter the invoice date as YYYY-MM-DD.');
    if (gstNumber && !validGst(gstNumber)) invalid('Enter a valid GSTIN or leave it blank.');
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) invalid('Enter a GST rate from 0 to 100.');
    if (!['issued', 'draft', 'cancelled'].includes(status)) invalid('Status must be issued, draft, or cancelled.');

    const invoice = cleanPayload({
      companyName, invoiceDate, quotationNumber, poNumber, items, status,
      leadDetails: { companyName, gstNumber, addressLine1, city, state, pinCode },
      invoiceDetails: paymentTerms ? { paymentTerms } : {}
    });
    const gstAmount = Math.round(invoice.subtotal * gstRate) / 100;
    const grandTotal = Math.round((invoice.subtotal + gstAmount) * 100) / 100;
    if (!Number.isSafeInteger(Math.round(grandTotal * 100))) invalid('The total is too large.');
    if (fields.expectedTotal && (!Number.isFinite(Number(fields.expectedTotal)) ||
      Math.round(Number(fields.expectedTotal) * 100) !== Math.round(grandTotal * 100))) {
      invalid('The calculated total for ' + proformaNumber + ' is ' + grandTotal.toFixed(2) + ' and differs from the original total entered.');
    }
    return { ...invoice, gstRate, gstAmount, grandTotal, proformaNumber, historicalImport: true };
  });
}

function historicalSequence(number) {
  const match = existingNumber.exec(number);
  return Number(match?.[1]);
}

module.exports = { parseHistoricalProformas, historicalSequence };

