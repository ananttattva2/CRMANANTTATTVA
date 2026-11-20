const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const pricing = require('../../../shared/eprCreditPricing.cjs');
const canDecide = user => String(user?.email || '').trim().toLowerCase() === pricing.approverEmail;
const fail = (res, code, error) => res.status(code).json({ error });
function changesFor(quotation, requested) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 200) throw new Error('Select at least one EPR Credit amount to request.');
  const seen = new Set();
  return requested.map(change => {
    const index = change.itemIndex;
    const item = quotation.items?.[index];
    if (!Number.isInteger(index) || seen.has(index) || !item || !pricing.isCredit(item)) throw new Error('Select valid, unique EPR Credit quotation rows.');
    seen.add(index);
    if (change.requestedAmount === '' || change.requestedAmount == null || !Number.isFinite(Number(change.requestedAmount)) || Number(change.requestedAmount) < 0 || Number(change.requestedAmount) > 1e9) throw new Error('Enter a valid requested amount for every selected credit row.');
    const amount = Math.round(Number(change.requestedAmount) * 100) / 100;
    return { itemIndex: index, basis: pricing.basis(item), item: typeof item.toObject === 'function' ? item.toObject() : { ...item }, currentAmount: Number(item.basicAmount) || 0, requestedAmount: amount };
  }).filter(change => change.requestedAmount !== change.currentAmount);
}
module.exports = ({ quotationAccessFilter }) => ({
  listCreditRateRequests: async (req, res) => {
    const scope = canDecide(req.user) ? {} : await quotationAccessFilter(req.user);
    const quotations = await Quotation.find({ $and: [scope, { 'creditRateRequests.0': { $exists: true } }] })
      .select('quotationNumber companyName leadDetails.companyName creditRateRequests').sort({ updatedAt: -1 }).limit(500).lean();
    const requests = quotations.flatMap(q => (q.creditRateRequests || []).map(request => ({ ...request, quotationId: String(q._id), quotationNumber: q.quotationNumber, companyName: q.companyName || q.leadDetails?.companyName })));
    res.json({ requests, canDecide: canDecide(req.user), approverEmail: pricing.approverEmail });
  },
  requestCreditRateChange: async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'Invalid quotation.');
    const quotation = await Quotation.findOne({ $and: [{ _id: req.params.id }, await quotationAccessFilter(req.user)] });
    if (!quotation) return fail(res, 404, 'Quotation not found.');
    if (quotation.pricingMode === 'combined') return fail(res, 400, 'Use individual pricing before requesting a credit rate change.');
    let changes;
    try { changes = changesFor(quotation, req.body?.changes); } catch (e) { return fail(res, 400, e.message); }
    if (!changes.length) return fail(res, 400, 'Requested amount must differ from the current amount.');
    const request = { id: crypto.randomUUID(), status: 'PENDING', createdAt: new Date(), requestedBy: String(req.user._id), requestedByName: req.user.name || req.user.email, requestedByEmail: req.user.email, changes };
    const saved = await Quotation.findOneAndUpdate({ _id: quotation._id, updatedAt: quotation.updatedAt, creditRateRequests: { $not: { $elemMatch: { status: 'PENDING' } } } }, { $push: { creditRateRequests: request } }, { new: true });
    if (!saved) return fail(res, 409, 'A request is already pending or the quotation changed. Refresh and try again.');
    res.status(201).json({ request });
  },
  decideCreditRateChange: async (req, res) => {
    if (!canDecide(req.user)) return fail(res, 403, 'Only anand.padhya@ananttattva.com can approve or reject EPR Credit rate requests.');
    if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 400, 'Invalid quotation.');
    const decision = String(req.body?.decision || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(decision)) return fail(res, 400, 'Choose Approve or Reject.');
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) return fail(res, 404, 'Quotation not found.');
    const requests = quotation.creditRateRequests.map(value => ({ ...value }));
    const request = requests.find(value => value.id === req.params.requestId);
    if (!request || request.status !== 'PENDING') return fail(res, 409, 'This request is no longer pending.');
    const items = quotation.items.map(item => item.toObject ? item.toObject() : { ...item });
    if (decision === 'APPROVED') {
      if (quotation.pricingMode === 'combined' || request.changes.some(change => !items[change.itemIndex] || !pricing.isCredit(items[change.itemIndex]) || pricing.basis(items[change.itemIndex]) !== change.basis || Number(items[change.itemIndex].basicAmount) !== change.currentAmount)) return fail(res, 409, 'Quotation items changed after this request. Reject it and request the current rates again.');
      request.changes.forEach(change => {
        const item = items[change.itemIndex];
        item.basicAmount = change.requestedAmount;
        item.creditRateApproval = { requestId: request.id, basis: change.basis, rate: change.requestedAmount, approvedBy: req.user.email, approvedAt: new Date() };
      });
    }
    Object.assign(request, { status: decision, decidedAt: new Date(), decidedBy: req.user.email });
    const update = { creditRateRequests: requests };
    if (decision === 'APPROVED') {
      const total = Math.round(items.reduce((sum, item) => sum + (Number(item.unit) || 1) * (Number(item.basicAmount) || 0), 0) * 100) / 100;
      Object.assign(update, { items, subtotal: total, grandTotal: total });
    }
    const saved = await Quotation.findOneAndUpdate({ _id: quotation._id, updatedAt: quotation.updatedAt, creditRateRequests: { $elemMatch: { id: request.id, status: 'PENDING' } } }, { $set: update }, { new: true });
    if (!saved) return fail(res, 409, 'Quotation changed during review. Refresh before deciding again.');
    res.json({ request, quotation: saved });
  }
});
module.exports._test = { canDecide, changesFor };
