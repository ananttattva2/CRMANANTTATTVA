function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

export function isEprCreditQuoteItem(item = {}) {
  return String(item.businessCategory || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprcredit';
}

export function eprCreditRatePerKg(item = {}) {
  const quotedRatePerKg = Number(item.basicAmount);
  return Number.isFinite(quotedRatePerKg) ? roundMoney(quotedRatePerKg) : 0;
}

export function eprCreditBasicAmountPerMt(ratePerKg) {
  return roundMoney(Number(ratePerKg) * 1000);
}

export function eprCreditTotalAmount(basicAmountPerMt, targetMt) {
  if (targetMt === '' || targetMt === null || targetMt === undefined) return null;
  const target = Number(targetMt);
  if (!Number.isFinite(target)) return null;
  return roundMoney(Number(basicAmountPerMt) * target);
}

export function quotationEprCreditCalculationRows(quotation = {}) {
  return (Array.isArray(quotation.items) ? quotation.items : [])
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => isEprCreditQuoteItem(item))
    .map(({ item, itemIndex }) => {
      const unitCount = String(item.unit || '1').trim() || '1';
      const unitName = String(item.unitLabel || item.unitName || '').trim().toUpperCase();
      const ratePerKg = eprCreditRatePerKg(item);
      const basicAmountPerMt = eprCreditBasicAmountPerMt(ratePerKg);
      const targetMt = item.eprCreditTargetMt !== null && item.eprCreditTargetMt !== undefined
        ? item.eprCreditTargetMt
        : item.eprCreditTargetKg !== null && item.eprCreditTargetKg !== undefined
          ? Number(item.eprCreditTargetKg) / 1000
          : '';
      return {
        itemIndex,
        servicesOffered: String(item.servicesOffered || item.applicableService || item.serviceCategory || '-').trim(),
        unit: [unitCount, unitName].filter(Boolean).join(' '),
        ratePerKg,
        basicAmount: basicAmountPerMt,
        targetMt,
        totalAmount: eprCreditTotalAmount(basicAmountPerMt, targetMt)
      };
    });
}
