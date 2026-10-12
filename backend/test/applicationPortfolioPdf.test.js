const test = require('node:test')
const assert = require('node:assert/strict')

test('portfolio PDF table mirrors visible rows and grand totals', async () => {
  const { buildApplicationPortfolioPdfData } = await import('../../frontend/src/utils/applicationPortfolioPdf.mjs')
  const columns = [['total', 'Total'], ['approved', 'Approved']]
  const groups = [
    { name: 'Sonal More', records: [{ approved: true }, { approved: false }] },
    { name: 'Saurabh Bhat', records: [{ approved: true }] }
  ]
  const matches = (row, key) => key === 'total' || row.approved === true
  assert.deepEqual(buildApplicationPortfolioPdfData({ columns, groups, matches }), {
    head: ['AnantTattva SPOC', 'Total', 'Approved'],
    body: [['Sonal More', 2, 1], ['Saurabh Bhat', 1, 1]],
    total: ['Grand Total', 3, 2]
  })
})
