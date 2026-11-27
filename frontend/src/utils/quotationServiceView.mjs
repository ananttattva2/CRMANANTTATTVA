import { normalizeCombinedPricingGroups, quotationItemKey, quotationItemsTotal } from './quotationDocument.mjs';

export function filterQuotationServices(quotation, status) {
  const items = quotation.items || [];
  const fallback = quotation.serviceState === 'closed' ? 'closed' : 'open';
  const matches = index => (quotation.itemClosureStates?.[index] || fallback) === status;
  const visibleItems = items.filter((_, index) => matches(index));
  if (!visibleItems.length) return null;

  let total = Number(quotation.grandTotal) || 0;
  if (visibleItems.length < items.length) {
    if (quotation.pricingMode === 'combined') {
      const visibleKeys = new Set(items.flatMap((item, index) => matches(index) ? [quotationItemKey(item, index)] : []));
      const groups = normalizeCombinedPricingGroups(quotation, items)
        .filter(group => group.itemKeys.some(key => visibleKeys.has(key)));
      const pricedKeys = new Set(groups.flatMap(group => group.itemKeys));
      const canTotal = [...visibleKeys].every(key => pricedKeys.has(key))
        && [...pricedKeys].every(key => visibleKeys.has(key));
      total = canTotal ? groups.reduce((sum, group) => sum + (Number(group.basicAmount) || 0), 0) : null;
    } else {
      total = quotationItemsTotal(visibleItems);
    }
  }

  const openCount = status === 'open' ? visibleItems.length : items.length - visibleItems.length;
  return {
    items: visibleItems,
    total: total === null ? null : Math.round(total * 100) / 100,
    status,
    openCount,
    closedCount: items.length - openCount
  };
}
