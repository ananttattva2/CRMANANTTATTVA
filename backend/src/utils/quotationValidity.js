function quotationValidityError(value) {
  const date = String(value || '').trim();
  if (!date) return 'Quotation Valid Until is required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Enter a valid Quotation Valid Until date.';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return 'Enter a valid Quotation Valid Until date.';
  return '';
}
module.exports = { quotationValidityError };
