import { test } from 'node:test'
import assert from 'node:assert/strict'
import { droppedProofFiles } from '../src/features/clientMaster/droppedProofFiles.mjs'

const eml = 'From: client@example.test\r\nTo: owner@example.test\r\nSubject: Client approval\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nPurchase information is approved.'
const email = () => new File([eml], 'approval.eml', { type: 'message/rfc822', lastModified: 100 })

test('normal file lists and item-based drops produce the same original email without duplicate uploads', async () => {
  const file = email()
  const files = await droppedProofFiles({ files: [file], items: [{ kind: 'file', getAsFile: () => file }] })
  assert.equal(files.length, 1); assert.equal(await files[0].text(), eml)
  assert.deepEqual(await droppedProofFiles({ files: [], items: [{ kind: 'file', getAsFile: () => file }] }), [file])
})

test('Outlook virtual file handles are requested in the drop tick before the protected store is closed', async () => {
  let readable = true, captured = false
  const file = email()
  const pending = droppedProofFiles({ files: [], items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle() { assert.equal(readable, true); captured = true; return Promise.resolve({ kind: 'file', getFile: async () => file }) } }] })
  readable = false
  assert.equal(captured, true)
  assert.deepEqual(await pending, [file])
})

test('legacy file entries work when Outlook getAsFile returns null', async () => {
  const file = email()
  const files = await droppedProofFiles({ items: [{ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({ isFile: true, file: done => queueMicrotask(() => done(file)) }) }] })
  assert.deepEqual(files, [file])
})

test('a rejected modern handle falls back to a legacy entry without losing the email', async () => {
  const file = email()
  const files = await droppedProofFiles({ items: [{ kind: 'file', getAsFile() { throw new Error('protected') }, getAsFileSystemHandle: () => Promise.reject(new Error('not supported')), getAsEntry: () => ({ isFile: true, file: done => done(file) }) }] })
  assert.deepEqual(files, [file])
})

test('a working handle does not wait for a broken entry callback to time out', async () => {
  const file = email()
  const pending = droppedProofFiles({ items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: 'file', getFile: async () => file }), webkitGetAsEntry: () => ({ isFile: true, file() {} }) }] }, { timeoutMs: 1000 })
  const result = await Promise.race([pending, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('fast handle waited for broken entry')), 200); timer.unref?.() })])
  assert.deepEqual(result, [file])
})

test('zero-byte Outlook placeholders are replaced by the materialized original', async () => {
  const file = email()
  const placeholder = new File([], file.name, { type: file.type })
  const files = await droppedProofFiles({ files: [placeholder], items: [{ kind: 'file', getAsFile: () => placeholder, getAsFileSystemHandle: async () => ({ kind: 'file', getFile: async () => file }) }] })
  assert.deepEqual(files, [file])
})

test('mixed proof files retain native files and a separately materialized Outlook email', async () => {
  const image = new File(['image'], 'proof.png', { type: 'image/png' }), file = email()
  const files = await droppedProofFiles({ files: [image], items: [{ kind: 'file', getAsFile: () => image }, { kind: 'file', getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: 'file', getFile: async () => file }) }] })
  assert.deepEqual(files, [image, file])
})

test('a protected files getter does not block item-based extraction', async () => {
  const file = email()
  assert.deepEqual(await droppedProofFiles({ get files() { throw new Error('protected') }, items: [{ kind: 'file', getAsFile: () => file }] }), [file])
})

test('complete RFC822 drag content becomes a genuine EML file with headers and body retained', async () => {
  const files = await droppedProofFiles({ types: ['message/rfc822'], getData: () => eml })
  assert.equal(files.length, 1); assert.equal(files[0].type, 'message/rfc822'); assert.equal(files[0].name, 'Client approval.eml'); assert.equal(await files[0].text(), eml)
})

test('string callbacks are registered before the drag store closes', async () => {
  let readable = true
  const pending = droppedProofFiles({ items: [{ kind: 'string', type: 'text/plain', getAsString(done) { assert.equal(readable, true); queueMicrotask(() => done(eml)) } }] })
  readable = false
  const files = await pending; assert.equal(await files[0].text(), eml)
})

test('an Outlook link, subject, or HTML selection never becomes fabricated email proof', async () => {
  for (const value of ['https://outlook.office.com/mail/inbox/id/123', 'Subject: Approval', '<p>Approved</p>']) assert.deepEqual(await droppedProofFiles({ types: ['text/plain'], getData: () => value }), [])
})

test('unsupported and stalled virtual sources finish without throwing or hanging', async () => {
  assert.deepEqual(await droppedProofFiles({ items: [{ kind: 'file', getAsFile: () => null, webkitGetAsEntry: () => ({ isFile: true, file() {} }) }] }, { timeoutMs: 10 }), [])
  assert.deepEqual(await droppedProofFiles({ items: [{ kind: 'file', getAsFile: () => null, getAsFileSystemHandle: async () => ({ kind: 'directory' }) }] }), [])
})
