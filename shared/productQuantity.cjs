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
    if (row.period && !['month', 'year'].includes(row.period)) return 'CTO/CCA Month/Year must be month or year.';
  }
  for (const key of ['serviceDetailsByAssignedServiceId', 'cpcbDataByAssignedServiceId']) for (const scope of Object.values(data?.[key] || {})) { const error = validateProductQuantities(scope); if (error) return error; }
  return '';
}
module.exports = { splitProductQuantity, normalizeProductQuantities, validateProductQuantities };
