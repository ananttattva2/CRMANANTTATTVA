export async function loadFullQuotation(row, fetchDetail) {
  if (!row) throw new Error('Quotation details are unavailable.');
  const sourceId = row.quotationId || row._id || row.id;
  if (!row._listOnly && !/^[a-f0-9]{24}$/i.test(String(sourceId || ''))) return row;
  const { data } = await fetchDetail(sourceId);
  if (!data?.quotation) throw new Error('Quotation details are unavailable.');
  return { ...data.quotation, approvalRecordId: row.approvalRecordId || data.quotation.approvalRecordId };
}
