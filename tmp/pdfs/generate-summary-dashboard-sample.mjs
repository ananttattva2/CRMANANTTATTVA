import fs from 'node:fs/promises'
import { createSalesRepPerformancePdf } from '../../frontend/src/utils/salesRepPerformancePdf.mjs'

const reps = Array.from({ length: 14 }, (_, index) => ({
  owner: `Sales Representative ${index + 1}`,
  totalLeads: 120 - index,
  hotClosed: 18 + index,
  hotOpen: 12 + index,
  hotUnassigned: index % 4,
  coldOpen: 25 + index,
  expectedRevenuePaise: 32500000 + index * 100000,
  poValuePaise: 21000000 + index * 75000
}))
const totals = reps.reduce((result, row) => {
  for (const field of ['totalLeads', 'hotClosed', 'hotOpen', 'hotUnassigned', 'coldOpen', 'expectedRevenuePaise', 'poValuePaise']) result[field] += row[field]
  return result
}, { totalLeads: 0, hotClosed: 0, hotOpen: 0, hotUnassigned: 0, coldOpen: 0, expectedRevenuePaise: 0, poValuePaise: 0 })

const { doc } = await createSalesRepPerformancePdf({
  reps,
  totals,
  summary: {
    hotOpen: 350,
    hotClosed: 64,
    hotExpectedRevenuePaise: 10462499800,
    hotQuotationValuePaise: 741967871000,
    hotPoValuePaise: 4040780200,
    coldOpen: 426,
    coldExpectedRevenuePaise: 9050010100
  },
  range: { label: 'All lead creation dates' }
})
await fs.writeFile(new URL('./summary-dashboard-sample.pdf', import.meta.url), Buffer.from(doc.output('arraybuffer')))
