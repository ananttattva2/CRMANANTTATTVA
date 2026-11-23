async function migrateProformaPrefix({ Model, connection, backup }) {
  const session = await connection.startSession();
  let changes = [];
  try {
    await session.withTransaction(async () => {
      const rows = await Model.find({ proformaNumber: /^PI\/\d{2}-\d{2}\/\d+$/i }).session(session).lean();
      changes = rows.map(row => ({ id: String(row._id), from: row.proformaNumber, to: row.proformaNumber.replace(/^PI\//i, 'ATPI/') }));
      if (!rows.length) return;
      const occupied = await Model.find({ proformaNumber: { $in: changes.map(row => row.to) } }).session(session).lean();
      if (occupied.length) throw new Error('ATPI invoice number already exists; prefix migration stopped without changes.');
      await backup(rows);
      for (let index = 0; index < rows.length; index++) {
        const result = await Model.updateOne({ _id: rows[index]._id, proformaNumber: changes[index].from }, { $set: { proformaNumber: changes[index].to } }, { session });
        if (result.modifiedCount !== 1) throw new Error('Invoice changed concurrently; prefix migration stopped.');
      }
    });
    return { count: changes.length, changes };
  } finally { await session.endSession(); }
}
module.exports = { migrateProformaPrefix };
