const ELIGIBLE_STATUSES = new Set(['submitted', 'sent', 'admin_approved', 'approved']);

function text(value) {
  return String(value ?? '').trim();
}

function quotationIsEligible(quotation = {}) {
  return ELIGIBLE_STATUSES.has(text(quotation.status).toLowerCase())
    && text(quotation.serviceState).toLowerCase() !== 'closed';
}

function quotationTime(quotation = {}) {
  const quotationDate = new Date(quotation.quotationDate || 0).getTime();
  const createdAt = new Date(quotation.createdAt || 0).getTime();
  return {
    quotationDate: Number.isFinite(quotationDate) ? quotationDate : 0,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0
  };
}

function isLaterQuotation(candidate, current) {
  if (!current) return true;
  const next = quotationTime(candidate);
  const prior = quotationTime(current);
  if (next.quotationDate !== prior.quotationDate) return next.quotationDate > prior.quotationDate;
  if (next.createdAt !== prior.createdAt) return next.createdAt > prior.createdAt;
  return text(candidate.quotationNumber).localeCompare(text(current.quotationNumber), undefined, { numeric: true }) > 0;
}

function leadQuotationKeys(lead = {}) {
  return [...new Set([
    text(lead._id),
    text(lead.leadCode),
    text(lead.sourceLeadId)
  ].filter(Boolean))];
}

function quotationKeys(quotation = {}) {
  return [...new Set([
    text(quotation.leadRef?._id || quotation.leadRef),
    text(quotation.leadId),
    text(quotation.leadCode),
    text(quotation.businessLeadCode)
  ].filter(Boolean))];
}

/**
 * Returns one amount per lead. A revised quotation never gets added to an
 * older quotation for the same lead; only the latest eligible record wins.
 */
function latestQuotationAmountsByLead(leads = [], quotations = []) {
  const latestByKey = new Map();
  for (const quotation of quotations) {
    if (!quotationIsEligible(quotation)) continue;
    for (const key of quotationKeys(quotation)) {
      if (isLaterQuotation(quotation, latestByKey.get(key))) latestByKey.set(key, quotation);
    }
  }

  const result = new Map();
  for (const lead of leads) {
    const candidates = leadQuotationKeys(lead).map((key) => latestByKey.get(key)).filter(Boolean);
    const latest = candidates.reduce((current, candidate) => isLaterQuotation(candidate, current) ? candidate : current, null);
    const amount = Number(latest?.grandTotal);
    result.set(String(lead._id), Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0);
  }
  return result;
}

module.exports = {
  ELIGIBLE_STATUSES,
  quotationIsEligible,
  isLaterQuotation,
  latestQuotationAmountsByLead
};
