const PO_FINANCIAL_YEARS = Array.from({ length: 8 }, (_, index) => `${2022 + index}-${String(2023 + index).slice(-2)}`);
function cleanPoCommercialDetails(row = {}) {
  return Object.fromEntries(['poEndDate', 'poFinancialYear', 'annualReturnYear', 'registrationYear', 'paymentTerm']
    .filter((field) => Object.prototype.hasOwnProperty.call(row, field))
    .map((field) => [field, String(row[field] || '').trim().slice(0, field === 'paymentTerm' ? 1000 : 30)]));
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
function validatePoCommercialDetails(row = {}) {
  if (row.poEndDate && !validDate(row.poEndDate)) return 'Enter a valid PO End Date.';
  if (row.poEndDate && validDate(row.poDate || '') && row.poEndDate < row.poDate) return 'PO End Date cannot be before PO Date.';
  if (row.poFinancialYear && !PO_FINANCIAL_YEARS.includes(row.poFinancialYear)) return 'Choose a PO Financial Year from 2022-23 to 2029-30.';
  if (row.registrationYear && !PO_FINANCIAL_YEARS.includes(row.registrationYear)) return 'Choose a Registration Year from 2022-23 to 2029-30.';
  if (row.annualReturnYear && !PO_FINANCIAL_YEARS.includes(row.annualReturnYear)) return 'Choose an Annual Return Year from 2022-23 to 2029-30.';
  return '';
}
module.exports = { PO_FINANCIAL_YEARS, cleanPoCommercialDetails, validatePoCommercialDetails };
