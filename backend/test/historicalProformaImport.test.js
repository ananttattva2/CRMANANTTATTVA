const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/proformaInvoiceController');
const ProformaInvoice = require('../src/models/ProformaInvoice');

const number = 'ATPI/26-27/001';
const invoice = {
  proformaNumber: number, invoiceDate: '2026-04-15', companyName: 'Example Client',
  serviceCategory: 'Consulting', quantity: 2, unitPrice: 100, gstRate: 0, expectedTotal: 250
};
const secondItem = { proformaNumber: number, serviceCategory: 'Filing', unitPrice: 50 };
const actor = { _id: '507f1f77bcf86cd799439011', roles: ['Finance'] };

async function upload(rows, user = actor) {
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return controller.importHistorical({ body: { rows }, user }, response, error => { throw error; });
}

test('historical PI import groups items, retains original numbers and skips existing PIs on retry', async t => {
  const saved = new Map([['PI/26-27/2', {}]]);
  t.mock.method(ProformaInvoice, 'find', () => ({
    select() { return this; },
    async lean() { return [...saved.keys()].map(proformaNumber => ({ proformaNumber })); }
  }));
  t.mock.method(ProformaInvoice, 'bulkWrite', async operations => {
    let upsertedCount = 0;
    for (const { updateOne } of operations) {
      const key = updateOne.filter.proformaNumber;
      assert.equal(updateOne.upsert, true);
      if (!saved.has(key)) {
        const payload = updateOne.update.$setOnInsert;
        assert.equal(new ProformaInvoice(payload).validateSync(), undefined);
        saved.set(key, payload);
        upsertedCount++;
      }
    }
    return { upsertedCount };
  });

  const rows = [
    invoice, secondItem,
    { ...invoice, proformaNumber: 'ATPI/26-27/002', expectedTotal: 200 },
    { proformaNumber: 'ATPI/26-27/003' }
  ];
  assert.deepEqual((await upload(rows)).body, { ok: true, created: 1, skipped: 1 });
  const stored = saved.get(number);
  assert.equal(stored.createdBy, actor._id);
  assert.equal(stored.invoiceDate, '2026-04-15');
  assert.equal(stored.historicalImport, true);
  assert.equal(stored.items.length, 2);
  assert.equal(stored.grandTotal, 250);
  assert.equal(stored.gstAmount, 0);
  assert.deepEqual((await upload(rows)).body, { ok: true, created: 0, skipped: 2 });
});

test('forbidden roles and invalid historical rows are rejected before any write', async t => {
  t.mock.method(ProformaInvoice, 'find', () => { throw new Error('Validation must run before database access'); });
  assert.equal((await upload([invoice], { ...actor, roles: ['Sales'] })).code, 403);

  for (const [changes, message] of [
    [{ invoiceDate: '2026-04-31' }, /Row 2:.*YYYY-MM-DD/],
    [{ proformaNumber: 'ATPI/26-27/203' }, /Row 2:.*ATPI\/26-27\/202/],
    [{ expectedTotal: 249 }, /differs from the original total/]
  ]) {
    const response = await upload([{ ...invoice, ...changes }, secondItem]);
    assert.equal(response.code, 400);
    assert.match(response.body.error, message);
  }
});

