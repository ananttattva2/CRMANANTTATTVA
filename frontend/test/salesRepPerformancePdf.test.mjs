import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesRepPerformancePdfRows, salesRepPerformancePdfHeaders } from '../src/utils/salesRepPerformancePdf.mjs'

test('Sales Rep Performance PDF includes traffic sources, service interests and totals', () => {
  const rows = buildSalesRepPerformancePdfRows([{
    owner: 'Example Owner',
    totalLeads: 12,
    hotClosed: 3,
    hotOpen: 4,
    hotUnassigned: 1,
    coldOpen: 4,
    expectedRevenuePaise: 12500000,
    poValuePaise: 7500000,
    trafficSources: [
      { label: 'Referral', count: 5 },
      { label: 'Website', count: 3 }
    ],
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

  assert.equal(salesRepPerformancePdfHeaders.includes('Traffic Source (Top 3)'), true)
  assert.equal(salesRepPerformancePdfHeaders.includes('Major Service Interest'), true)
  assert.equal(salesRepPerformancePdfHeaders.length, 10)
  assert.deepEqual(rows[0], ['Example Owner', '12', '3', '4', '1', '4', 'INR 1,25,000.00', 'INR 75,000.00', 'Referral (5)\nWebsite (3)', 'EPR - Plastic Waste (8)'])
  assert.equal(rows.at(-1)[0], 'Grand Total')
  assert.deepEqual(rows.at(-1).slice(-2), ['-', '-'])
})
