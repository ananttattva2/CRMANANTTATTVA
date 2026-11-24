import test from 'node:test'
import assert from 'node:assert/strict'
import { groupCteCtoClients, cteCtoExportRows } from '../src/utils/cteCtoDirectory.mjs'

const record = (id, basic = {}, extra = {}) => ({ _id: id, assignedServiceId: id, data: { basic: { clientLegalName: 'CANON LAMINATORS PRIVATE LIMITED', applicantType: 'PIBO', piboCategory: 'Producer', eprCategory: 'EPR - Plastic Waste', ...basic }, ...extra } })

test('legacy and new assignment show one consent applicant without losing documents or people', () => {
  const saved = record('legacy', {}, { cte: { plantWiseDetails: [{ plantName: 'Plant 1', cteConsentNo: 'CONSENT-1', cteDocument: { url: 'https://example.test/cte.pdf' } }] } })
  const draft = record('new', { plantUnit: 'Unit 1', eprCategory: 'EPR-PLASTIC' }, { authorised: { name: 'Saved contact' } })
  const before = JSON.stringify([saved, draft])
  for (const records of [[saved, draft], [draft, saved]]) {
    const [group] = groupCteCtoClients(records)
    assert.equal(group.records.length, 1)
    assert.equal(group.records[0].id, 'legacy')
    assert.equal(group.records[0].cte.plantWiseDetails[0].cteConsentNo, 'CONSENT-1')
    assert.equal(group.records[0].authorisedPersons[0].name, 'Saved contact')
    assert.equal(cteCtoExportRows([group]).length, 1)
  }
  assert.equal(JSON.stringify([saved, draft]), before)
})

test('different units, applicants and waste categories stay separate; missing unit is not guessed', () => {
  const rows = [record('one', { plantUnit: 'Unit 1' }), record('two', { plantUnit: 'Unit 2' }), record('unknown'), record('brand', { piboCategory: 'Brand Owner' }), record('battery', { eprCategory: 'Battery Waste' })]
  assert.equal(groupCteCtoClients(rows)[0].records.length, 5)
})

test('identical consent plants are not counted twice across duplicate masters', () => {
  const details = { cte: { plantWiseDetails: [{ plantName: 'Same plant', cteConsentNo: 'CONSENT-1' }] } }
  const [group] = groupCteCtoClients([record('one', {}, details), record('two', {}, details)])
  assert.equal(group.records.length, 1)
  assert.equal(cteCtoExportRows([group]).length, 1)
})
