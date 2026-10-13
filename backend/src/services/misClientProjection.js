// MIS completion counts need presence, not megabytes of embedded file data.
// Keep scalar types, object keys and array lengths; only long strings become a
// non-empty marker. Detailed work reports continue to read original documents.
function presenceValue(input, depth = 7) {
  const string = { $cond: [{ $gt: [{ $strLenBytes: '$$value' }, 4096] },
    { $cond: [{ $eq: [{ $trim: { input: '$$value' } }, ''] }, '', '[attached]'] }, '$$value'] };
  const branches = [{ case: { $eq: [{ $type: '$$value' }, 'string'] }, then: string }];
  if (depth > 0) branches.push(
    { case: { $isArray: '$$value' }, then: { $map: { input: '$$value', as: 'entry', in: presenceValue('$$entry', depth - 1) } } },
    { case: { $eq: [{ $type: '$$value' }, 'object'] }, then: { $arrayToObject: { $map: {
      input: { $objectToArray: '$$value' }, as: 'entry', in: { k: '$$entry.k', v: presenceValue('$$entry.v', depth - 1) }
    } } } }
  );
  return { $let: { vars: { value: input }, in: { $switch: { branches, default: '$$value' } } } };
}
const misClientProjection = { createdBy: 1, workflowStatus: 1, 'adminControls.approvalStatus': 1,
  createdAt: 1, updatedAt: 1, selectedLead: 1, assignedServiceId: 1, data: presenceValue('$data') };
module.exports = { presenceValue, misClientProjection };
