import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesRepPerformancePdfRows, salesRepPerformancePdfHeaders } from '../src/utils/salesRepPerformancePdf.mjs'

test('Sales Rep Performance PDF excludes Major Service Interest and includes totals', () => {
  const rows = buildSalesRepPerformancePdfRows([{
    owner: 'Example Owner',
    totalLeads: 12,
    hotClosed: 3,
    hotOpen: 4,
    hotUnassigned: 1,
    coldOpen: 4,
    expectedRevenuePaise: 12500000,
    poValuePaise: 7500000,
    serviceInterests: [{ label: 'EPR - Plastic Waste', count: 8 }]
  }], {
    totalLeads: 12,
    hotClosed: 3,
    hotOpen: 4,
    hotUnassigned: 1,
    coldOpen: 4,
    expectedRevenuePaise: 12500000,
    poValuePaise: 7500000
  })

  assert.equal(salesRepPerformancePdfHeaders.includes('Major Service Interest'), false)
  assert.equal(salesRepPerformancePdfHeaders.length, 8)
  assert.deepEqual(rows[0], ['Example Owner', '12', '3', '4', '1', '4', 'INR 1,25,000.00', 'INR 75,000.00'])
  assert.equal(rows.at(-1)[0], 'Grand Total')
  assert.equal(JSON.stringify(rows).includes('EPR - Plastic Waste'), false)
})
