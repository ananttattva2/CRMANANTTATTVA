const test = require('node:test')
const assert = require('node:assert/strict')

const owner = (name, role, totalLeads, openLeads, closedLeads, temporaryLeads = 0) => ({ name, role, team: role === 'sales' ? 'Sales' : ['superadmin', 'management', 'admin'].includes(role) ? 'Management' : 'Operations', totalLeads, openLeads, closedLeads, temporaryLeads })

test('Sales MIS model preserves supplied lead totals and keeps temporary leads separate', async () => {
  const { buildSalesMisReport } = await import('../../frontend/src/utils/salesMisReport.mjs')
  const rows = [
    owner('Gaurav Chandra', 'sales', 162, 124, 38, 11), owner('Mihirdevsinh Zala', 'sales', 117, 116, 1),
    owner('Kshitij Trimukhe', 'sales', 2, 2, 0), owner('Parth Joshi', 'sales', 0, 0, 0),
    owner('Chandrabhan Singh', 'sales', 0, 0, 0, 21), owner('Khushboo Bhavsar', 'sales', 24, 24, 0, 72),
    owner('Suraj Shetty', 'sales', 1, 1, 0, 44), owner('Anand Padhya', 'superadmin', 158, 113, 45),
    owner('Krunal Goda', 'management', 23, 17, 6), owner('Test Admin', 'admin', 999, 999, 0, 999),
    owner('Operations User', 'operation', 100, 100, 0, 100)
  ]
  const model = buildSalesMisReport(rows)
  assert.deepEqual(model.totals, { total: 487, open: 397, closed: 90, temporary: 148, closeRate: 18 })
  assert.deepEqual(model.groups.map(({ name, users, total, open, closed, closeRate }) => ({ name, users, total, open, closed, closeRate })), [
    { name: 'Sales Team', users: 7, total: 306, open: 267, closed: 39, closeRate: 13 },
    { name: 'Management', users: 2, total: 181, open: 130, closed: 51, closeRate: 28 }
  ])
  assert.deepEqual(model.ranked.slice(0, 4).map((row) => [row.name, row.closedLeads, row.closeRate]), [
    ['Anand Padhya', 45, 28], ['Gaurav Chandra', 38, 23], ['Krunal Goda', 6, 26], ['Mihirdevsinh Zala', 1, 1]
  ])
  assert.equal(model.focusOpen, 240)
  assert.equal(model.focusPercent, 60)
})

test('Sales MIS handles owners with zero total leads without division errors', async () => {
  const { buildSalesMisReport } = await import('../../frontend/src/utils/salesMisReport.mjs')
  const model = buildSalesMisReport([owner('Zero Owner', 'sales', 0, 0, 0, 5)])
  assert.equal(model.owners[0].closeRate, 0)
  assert.equal(model.totals.closeRate, 0)
})
