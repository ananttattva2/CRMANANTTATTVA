// Shared by form hydration, API writes, exports and the legacy-data repair.
function splitProductQuantity(row = {}) {
  const raw = String(row.quantity ?? '').trim();
  const match = raw.match(/^([0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+)\s*(.*?)\s*$/);
  if (!match || /^[eE][+-]?\d/.test(match[2])) return { ...row }; // Keep unrecognised historical text for review.
  const suffix = match[2].match(/^(.*?)\s*(?:\/|\bper\b)\s*(months?|monthly|years?|yearly|annum|annually)\s*$/i);
  const period = suffix?.[2]?.toLowerCase();
  return { ...row, quantity: match[1].replace(/,/g, ''),
    uom: row.uom || (suffix ? suffix[1] : match[2]).trim().toLowerCase(),
    period: row.period || (period ? (/^month/.test(period) ? 'month' : 'year') : '') };
}
function quantityUom(row = {}) {
  return String(row.uom || '').trim().toLowerCase();
}
function needsPieceWeight(row = {}) {
  const uom = quantityUom(row);
  return Boolean(uom) && !['kg', 'kgs', 'kilogram', 'kilograms', 'mt', 'metric ton', 'metric tons', 'metric tonne', 'metric tonnes'].includes(uom);
}
function nonNegativeNumber(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function calculateMtPerYear(input = {}) {
  const row = splitProductQuantity(input);
  const quantity = nonNegativeNumber(row.quantity);
  const period = String(row.period || '').trim().toLowerCase();
  const uom = quantityUom(row);
  if (quantity === null || !uom || !['month', 'year'].includes(period)) return null;
  let mt;
  if (needsPieceWeight(row)) {
    const weight = nonNegativeNumber(row.pieceWeight);
    const weightUom = String(row.pieceWeightUom || '').trim().toLowerCase();
    if (weight === null || !['kg', 'g'].includes(weightUom)) return null;
    mt = quantity * weight / (weightUom === 'g' ? 1000000 : 1000);
  } else {
    mt = quantity / (['kg', 'kgs', 'kilogram', 'kilograms'].includes(uom) ? 1000 : 1);
  }
  const annual = mt * (period === 'month' ? 12 : 1);
  return Number.isFinite(annual) ? Number(annual.toPrecision(15)) : null;
}
function formatMtPerYear(row = {}) {
  const value = calculateMtPerYear(row);
  return value === null ? '' : String(value);
}
function normalizeProductQuantities(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const result = { ...data };
  if (Array.isArray(data.cte?.plantWiseDetails)) result.cte = { ...data.cte, plantWiseDetails: data.cte.plantWiseDetails.map(plant => ({ ...plant, ...(Array.isArray(plant.ctoProductRows) ? { ctoProductRows: plant.ctoProductRows.map(splitProductQuantity) } : {}) })) };
  for (const key of ['serviceDetailsByAssignedServiceId', 'cpcbDataByAssignedServiceId']) {
    if (data[key] && typeof data[key] === 'object') result[key] = Object.fromEntries(Object.entries(data[key]).map(([id, scope]) => [id, normalizeProductQuantities(scope)]));
  }
  return result;
}
function validateProductQuantities(data) {
  for (const plant of data?.cte?.plantWiseDetails || []) for (const row of plant.ctoProductRows || []) {
    if (String(row.quantity ?? '').trim() && !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(row.quantity))) return 'CTO/CCA Quantity must contain only a non-negative number. Enter UOM and Month/Year separately.';
    if (needsPieceWeight(row) && String(row.pieceWeight ?? '').trim() && nonNegativeNumber(row.pieceWeight) === null) return 'Per Piece Weight must contain only a non-negative number.';
    if (needsPieceWeight(row) && row.pieceWeightUom && !['kg', 'g'].includes(row.pieceWeightUom)) return 'PPW UOM must be kg or g.';
    if (row.period && !['month', 'year'].includes(row.period)) return 'CTO/CCA Month/Year must be month or year.';
  }
  for (const key of ['serviceDetailsByAssignedServiceId', 'cpcbDataByAssignedServiceId']) for (const scope of Object.values(data?.[key] || {})) { const error = validateProductQuantities(scope); if (error) return error; }
  return '';
}
module.exports = { needsPieceWeight, calculateMtPerYear, formatMtPerYear, splitProductQuantity, normalizeProductQuantities, validateProductQuantities };
