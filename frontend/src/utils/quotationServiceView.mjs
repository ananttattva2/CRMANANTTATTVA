import { normalizeCombinedPricingGroups, quotationItemKey, quotationItemsTotal } from './quotationDocument.mjs';
import { inPipelinePeriod } from './leadPipeline.mjs';

export function hotQuotationLeadIds(rows, range) {
  return new Set(rows
    .filter(row => row.kind === 'hot' && row.id && inPipelinePeriod(row.createdAt, range))
    .map(row => String(row.id)));
}

export function quotationMatchesLeadIds(quotation, leadIds) {
  return leadIds.has(String(quotation.linkedLeadId || quotation.leadRef || quotation.leadId || ''));
}

function isClosedService(quotation, index) {
  return (quotation.itemClosureStates?.[index] || quotation.serviceState) === 'closed';
}

export function countQuotationServices(quotation) {
  const items = quotation.items || [];
  const closed = items.reduce((count, _, index) => count + Number(isClosedService(quotation, index)), 0);
  return { closed, open: items.length - closed };
}

export function filterQuotationServices(quotation, status) {
  const items = quotation.items || [];
  const matches = index => isClosedService(quotation, index) === (status === 'closed');
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

  return {
    items: visibleItems,
    total: total === null ? null : Math.round(total * 100) / 100,
    status
  };
}
