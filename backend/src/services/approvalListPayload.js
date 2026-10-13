// PO proof bytes belong to the authenticated detail endpoint. Keep normal
// links and metadata, including legacy amount recovery, in the list.
function withoutInlineProofs(value) {
  if (typeof value === 'string') return value.startsWith('data:') ? '' : value;
  if (Array.isArray(value)) return value.map(withoutInlineProofs);
  if (!value || typeof value !== 'object' || value instanceof Date || typeof value.toHexString === 'function') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withoutInlineProofs(entry)]));
}
module.exports = { withoutInlineProofs };
