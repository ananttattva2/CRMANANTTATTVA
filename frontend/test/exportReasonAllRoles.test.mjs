import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportWithReason } from '../src/utils/dataExport.mjs'

test('staff, admin and superadmin must provide an export reason; cancellation never saves a file', async () => {
  let dialog, saves = 0
  const form = {}, cancel = {}, submit = {}, input = { value: '', focus() {} }, error = {}
  globalThis.document = { createElement() { dialog = { style: {}, addEventListener() {}, setAttribute() {}, close() {}, remove() {}, showModal() {}, querySelector(selector) { return ({ form, 'button[type=button]': cancel, 'button[type=submit]': submit, textarea: input, '[role=alert]': error })[selector] } }; return dialog }, body: { appendChild() {} } }
  try {
    for (const role of ['sales', 'admin', 'superadmin']) {
      globalThis.localStorage = { getItem: () => JSON.stringify({ role }) }
      const result = exportWithReason('clients.xlsx', () => { saves++ })
      assert.ok(dialog)
      await form.onsubmit({ preventDefault() {} })
      assert.match(error.textContent, /at least 5 characters/)
      cancel.onclick()
      assert.equal(await result, false)
    }
    assert.equal(saves, 0)
  } finally { delete globalThis.document; delete globalThis.localStorage }
})
