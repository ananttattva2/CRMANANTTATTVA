const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { Readable } = require('node:stream');
const storage = require('../src/services/spacesStorage');

test('closing a preview aborts pending storage work and destroys its stream', async () => {
  const originalGet = storage.get;
  const originalValidLink = storage.validLink;
  const route = require.resolve('../src/routes/assets');
  delete require.cache[route];
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let cancelled;
  const aborted = new Promise(resolve => { cancelled = resolve; });
  let stream;
  storage.validLink = () => true;
  storage.get = async (key, { abortSignal }) => {
    started();
    await new Promise(resolve => abortSignal.addEventListener('abort', resolve, { once: true }));
    stream = new Readable({ read() {} });
    cancelled();
    return { Body: stream };
  };
  const app = express();
  app.use('/api/assets', require(route));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const request = http.get(`http://127.0.0.1:${server.address().port}/api/assets/file?key=fixture`);
    request.on('error', () => {});
    await ready;
    request.destroy();
    await Promise.race([aborted, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Storage request was not aborted')), 1000);
      timer.unref();
    })]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stream.destroyed, true);
  } finally {
    storage.get = originalGet;
    storage.validLink = originalValidLink;
    delete require.cache[route];
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
