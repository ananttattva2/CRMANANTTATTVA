// MIS completion counts need presence, not megabytes of embedded file data.
// Keep scalar types, object keys and array lengths; only long strings become a
// non-empty marker. Detailed work reports continue to read original documents.
// Keep the complete aggregate command below Atlas' 50-level BSON limit.
// Deeper values remain unchanged, preserving their original completion meaning.
function presenceValue(input, depth = 3) {
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
async function readMisClients(Client, filter) {
  try {
    return await Client.aggregate([{ $match: filter }, { $project: misClientProjection }]).option({ maxTimeMS: 20000 });
  } catch (error) {
    if (error.code !== 8000) throw error;
    console.warn('[MIS] Atlas rejected compact projection; reading original scoped records.');
    return Client.find(filter).select('createdBy data workflowStatus adminControls.approvalStatus createdAt updatedAt selectedLead assignedServiceId').maxTimeMS(20000).lean();
  }
}
module.exports = { presenceValue, misClientProjection, readMisClients };
