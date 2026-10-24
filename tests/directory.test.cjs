const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function manifest(name, modified, extra = {}) {
  return { inner_path: name, modified, files: { 'data.json': {} }, ...extra };
}
function client(response, embedded = true, timers = { setTimeout, clearTimeout }) {
  const calls = [];
  const c = { ...timers, Page: {
    isEmbedded: embedded,
    async cmd(command, params) {
      calls.push({ command, params });
      return typeof response === 'function' ? response() : response;
    }
  } };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/utils/XidDirectory.js'), 'utf8'), c);
  return { directory: c.XidDirectory, calls };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('lists the newest five local xIDs using signed publication times in seconds', async () => {
  const { directory, calls } = client([
    manifest('older.epix', 1700000000),
    manifest('third.epix', 1700000003),
    manifest('latest.epix', 1700000005),
    manifest('second.other', 1700000004),
    manifest('fourth.epix', 1700000002),
    manifest('fifth.epix', 1700000001)
  ]);
  const entries = plain(await directory.latest());
  assert.deepEqual(entries.map(entry => entry.name), ['latest', 'second', 'third', 'fourth', 'fifth']);
  assert.deepEqual(entries[0], { name: 'latest', tld: 'epix', timestamp: '2023-11-14T22:13:25.000Z' });
  assert.equal(entries[1].tld, 'other');
  assert.deepEqual(plain(calls), [{ command: 'fileQuery', params: { dir_inner_path: 'data/users/*/content.json', query: '' } }]);
});

test('new data and regenerated identity bundles move an existing xID to the top without duplicate names', async () => {
  const rows = [manifest('alice.epix', 1700000000), manifest('bob.epix', 1700000001)];
  const { directory } = client(() => rows);
  assert.equal((await directory.latest())[0].name, 'bob');
  rows.push(manifest('alice.epix', 1700000002, { files: { 'data-epix1device.json': {} } }));
  const updated = await directory.latest();
  assert.equal(updated.length, 2);
  assert.equal(updated[0].name, 'alice');
  assert.equal(updated[0].timestamp, '2023-11-14T22:13:22.000Z');
});

test('ignores unrelated paths, invalid names or dates and manifests without user data', async () => {
  const rows = [null, {}, [],
    manifest('content.json', 1700000000, { files: {} }),
    manifest('data/users/alice.epix/content.json', 1700000000),
    manifest('../alice.epix', 1700000000),
    manifest('alice.epix/child', 1700000000),
    manifest('<script>.epix', 1700000000),
    manifest('-alice.epix', 1700000000),
    manifest('a'.repeat(65) + '.epix', 1700000000),
    ...[null, '1700000000', 0, -1, NaN, Infinity, 1e20].map(value => manifest('invalid.epix', value)),
    ...[null, [], {}, { 'other.json': {} }, { '../data.json': {} }].map(files => manifest('empty.epix', 1700000000, { files })),
    manifest('valid-name.epix', 1700000001)
  ];
  const { directory } = client(rows);
  assert.deepEqual(plain(await directory.latest()).map(entry => entry.name), ['valid-name']);
});

test('returns deterministic ties and honors the requested limit up to five names', async () => {
  const { directory } = client(['f', 'e', 'd', 'c', 'b', 'a'].map(name => manifest(name + '.epix', 1700000000)));
  assert.deepEqual(plain(await directory.latest(2)).map(entry => entry.name), ['a', 'b']);
  assert.equal((await directory.latest(100)).length, 5);
});

test('empty local directories succeed while command errors and malformed replies reject', async () => {
  assert.deepEqual(plain(await client([]).directory.latest()), []);
  for (const response of [null, {}, { error: 'unsupported command' }, 'bad']) {
    await assert.rejects(client(response).directory.latest(), /Could not read/);
  }
  await assert.rejects(client(() => { throw new Error('disconnected'); }).directory.latest(), /disconnected/);
});

test('standalone requests fail immediately without waiting for a wrapper', async () => {
  const { directory, calls } = client([], false);
  await assert.rejects(directory.latest(), /Open this xite in EpixNet/);
  assert.equal(calls.length, 0);
});

test('a lost wrapper reply times out, ignores a late result and permits a fresh query', async () => {
  let timeout, delay, resolveLost, calls = 0;
  const cleared = [];
  const { directory } = client(() => ++calls === 1 ? new Promise(resolve => { resolveLost = resolve; }) : [manifest('fresh.epix', 1700000002)], true, {
    setTimeout(callback, ms) { timeout = callback; delay = ms; return 1; },
    clearTimeout(id) { cleared.push(id); }
  });
  const request = directory.latest();
  const rejected = assert.rejects(request, /did not respond/);
  assert.equal(delay, 15000);
  timeout();
  await rejected;
  resolveLost([manifest('stale.epix', 1700000000)]);
  assert.equal((await directory.latest())[0].name, 'fresh');
  assert.deepEqual(cleared, [1, 1]);
});
