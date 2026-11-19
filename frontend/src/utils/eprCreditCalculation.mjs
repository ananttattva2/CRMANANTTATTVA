function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

export function isEprCreditQuoteItem(item = {}) {
  return String(item.businessCategory || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprcredit';
}

export function eprCreditRatePerKg(item = {}) {
  const quotedRatePerGram = Number(item.basicAmount);
  return Number.isFinite(quotedRatePerGram) ? roundMoney(quotedRatePerGram * 1000) : 0;
}

export function eprCreditTotalAmount(ratePerKg, targetKg) {
  if (targetKg === '' || targetKg === null || targetKg === undefined) return null;
  const target = Number(targetKg);
  if (!Number.isFinite(target)) return null;
  return roundMoney(Number(ratePerKg) * target);
}

export function quotationEprCreditCalculationRows(quotation = {}) {
  return (Array.isArray(quotation.items) ? quotation.items : [])
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => isEprCreditQuoteItem(item))
    .map(({ item, itemIndex }) => {
      const unitCount = String(item.unit || '1').trim() || '1';
      const unitName = String(item.unitLabel || item.unitName || '').trim().toUpperCase();
      const ratePerKg = eprCreditRatePerKg(item);
      const targetKg = item.eprCreditTargetKg ?? '';
      return {
        itemIndex,
        servicesOffered: String(item.servicesOffered || item.applicableService || item.serviceCategory || '-').trim(),
        unit: [unitCount, unitName].filter(Boolean).join(' '),
        quotedRatePerGram: Number(item.basicAmount) || 0,
        basicAmount: ratePerKg,
        targetKg,
        totalAmount: eprCreditTotalAmount(ratePerKg, targetKg)
      };
    });
}
