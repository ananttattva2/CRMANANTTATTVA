const STAGES = ['partial', 'complete'];
const DATA_ROWS = new Set(['Received from client', 'Ready to upload']);
function receiptTracking(row, existing, files, user, now = new Date()) {
  const result = { receiptHistory: [...(existing.receiptHistory || [])] };
  for (const stage of STAGES) {
    const field = `${stage}DataReceived`;
    const checked = row.yesNo === 'Yes' && row[field] === true;
    const evidence = files.filter(file => file.receiptStage === stage);
    const changed = checked !== Boolean(existing[field]);
    result[field] = checked;
    result[`${stage}ReceivedAt`] = existing[`${stage}ReceivedAt`] || '';
    if (DATA_ROWS.has(row.particular) && changed) {
      const at = now.toISOString();
      if (checked) {
        result[`${stage}ReceivedAt`] = at;
        result.date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      }
      result.receiptHistory.push({ stage, checked, at, userId: String(user?._id || ''), userName: user?.name || user?.email || '', files: evidence.map(file => ({ ...file })) });
    }
  }
  return result;
}
module.exports = { receiptTracking };
