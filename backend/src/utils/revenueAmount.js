function parseRevenuePaise(value, { allowZero = false } = {}) {
  let text = String(value ?? '').trim().replace(/^₹\s*/, '');
  if (!text || text.length > 64) throw new Error('Enter a revenue amount.');
  const parts = text.split('.');
  if (parts.length > 2) throw new Error('Enter a valid amount, for example 100000 or 1,00,000.');
  let whole = parts[0];
  const fraction = parts[1] || '';
  if (whole.includes(',')) {
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$/.test(whole)) throw new Error('Enter a valid amount, for example 100000 or 1,00,000.');
    whole = whole.replace(/,/g, '');
  }
  if (whole === '' && fraction) whole = '0';
  if (!/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction))) throw new Error('Use digits and at most two decimal places; exponent notation is not supported.');
  if (fraction.slice(2).replace(/0/g, '')) throw new Error('Revenue can have at most two decimal places.');
  whole = whole.replace(/^0+(?=\d)/, '');
  if (whole.length > 10) throw new Error('Revenue must be below ₹10,00,00,00,000.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise < 0 || (!allowZero && paise === 0)) throw new Error(allowZero ? 'Revenue cannot be negative.' : 'Revenue must be greater than zero.');
  return paise;
}
module.exports = { parseRevenuePaise };
