// Rule 19: the Mock/Real toggle's API. This app is mock only, so Real is never available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request, startTestServer } from './helpers.js';

const mode = (port, body) => request(port, 'POST', '/api/mode', { body });

test('local: /api/info says Mock with no Real, and /api/mode keeps Mock, refuses Real (409) and bad bodies (400)', async () => {
  const srv = await startTestServer();
  try {
    const info = (await request(srv.port, 'GET', '/api/info')).json;
    assert.equal(info.source, 'mock'); assert.equal(info.realAvailable, false);
    const keep = await mode(srv.port, { source: 'mock' });
    assert.equal(keep.status, 200); assert.equal(keep.json.source, 'mock');
    const real = await mode(srv.port, { source: 'real' });
    assert.equal(real.status, 409); assert.match(real.json.message, /no live version/);
    for (const body of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, []]) assert.equal((await mode(srv.port, body)).status, 400, JSON.stringify(body));
  } finally { await srv.close(); }
});
