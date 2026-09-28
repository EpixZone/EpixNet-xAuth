const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function registration(name, tld = 'epix') {
  return { type: 'xid_name_registered', attributes: [
    { key: 'name', value: name, index: true },
    { key: 'tld', value: tld, index: true },
    { key: 'owner', value: 'epix1owner', index: true }
  ] };
}
function tx(index, names = ['name' + index], extra = {}) {
  return {
    code: 0,
    height: String(1000 - index),
    txhash: index.toString(16).padStart(64, '0'),
    timestamp: '2026-09-25T02:53:54Z',
    events: names.map(name => registration(name)),
    ...extra
  };
}
function history(rows, total = rows.length) {
  return { txs: [], tx_responses: rows, pagination: null, total: String(total) };
}
function client(responder) {
  const urls = [];
  const c = {
    AbortController, setTimeout, clearTimeout,
    Chain: { restUrls: ['https://node.example'] },
    async fetch(url) {
      urls.push(new URL(url));
      const result = await responder(urls[urls.length - 1], urls.length);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => result };
    }
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/utils/Rest.js'), 'utf8'), c);
  return { rest: c.Rest, urls, c };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('queries the shared Cosmos registration event across TLDs, including EVM and native registrations', async () => {
  const evm = tx(1, ['zinctrackers'], {
    tx: { body: { messages: [{ '@type': '/cosmos.evm.vm.v1.MsgEthereumTx' }] } }
  });
  evm.events.unshift({ type: 'ethereum_tx', attributes: [{ key: 'ethereumTxHash', value: '0xevmhash' }] });
  const native = tx(2, [], {
    tx: { body: { messages: [{ '@type': '/xid.v1.MsgRegisterName' }] } },
    events: [registration('second', 'other')]
  });
  const { rest, urls } = client(() => history([evm, native]));
  assert.deepEqual(plain(await rest.latestRegistrations()), [
    { name: 'zinctrackers', tld: 'epix', txHash: evm.txhash.toUpperCase(), timestamp: evm.timestamp, height: evm.height },
    { name: 'second', tld: 'other', txHash: native.txhash.toUpperCase(), timestamp: native.timestamp, height: native.height }
  ]);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, '/cosmos/tx/v1beta1/txs');
  assert.equal(urls[0].searchParams.get('query'), 'xid_name_registered.name EXISTS');
  assert.equal(urls[0].searchParams.get('order_by'), 'ORDER_BY_DESC');
  assert.equal(urls[0].searchParams.get('limit'), '5');
  assert.equal(urls[0].searchParams.get('page'), '1');
});

test('uses reverse event order for batched registrations and preserves descending transaction order in a block', async () => {
  const newer = tx(1, ['first', 'second'], { height: '9007199254740994' });
  newer.events.push(registration('second'));
  const sameBlock = tx(2, ['third'], { height: newer.height });
  const older = tx(3, ['fourth'], { height: '9007199254740993' });
  const { rest } = client(() => history([newer, sameBlock, older]));
  const rows = await rest.latestRegistrations();
  assert.deepEqual(Array.from(rows, row => row.name), ['second', 'first', 'third', 'fourth']);
  assert.equal(rows[0].height, '9007199254740994');
});

test('never includes a failed transaction and follows pages until five successful registrations are found', async () => {
  const failed = tx(1, ['failed'], { code: 4 });
  const { rest, urls } = client((url, call) => {
    assert.equal(url.searchParams.get('page'), String(call));
    return call === 1 ? history([failed, tx(2), tx(3), tx(4), tx(5)], 6) : history([tx(6)], 6);
  });
  assert.deepEqual(Array.from(await rest.latestRegistrations(), row => row.name), ['name2', 'name3', 'name4', 'name5', 'name6']);
  assert.equal(urls.length, 2);
});

test('deduplicates overlapping pages without mistaking them for complete history', async () => {
  const { rest, urls } = client((url, call) => {
    if (call === 1) return history([tx(1), tx(2)], 5);
    if (call === 2) return history([tx(2), tx(3)], 5);
    return history([tx(4), tx(5)], 5);
  });
  assert.deepEqual(Array.from(await rest.latestRegistrations(), row => row.name), ['name1', 'name2', 'name3', 'name4', 'name5']);
  assert.equal(urls.length, 3);
});

test('returns the real available count and does not invent dates or hashes for missing history', async () => {
  const { rest, urls } = client(() => history([tx(1), tx(2)], 2));
  assert.equal((await rest.latestRegistrations(5)).length, 2);
  assert.equal(urls.length, 1);
  const empty = client(() => history([]));
  assert.deepEqual(plain(await empty.rest.latestRegistrations()), []);
});

test('honors smaller requested limits and caps a request at five registrations', async () => {
  const { rest, urls } = client(() => history([tx(1), tx(2), tx(3), tx(4), tx(5), tx(6)]));
  assert.equal((await rest.latestRegistrations(2)).length, 2);
  assert.equal(urls[0].searchParams.get('limit'), '2');
  assert.equal((await rest.latestRegistrations(100)).length, 5);
  assert.equal(urls[1].searchParams.get('limit'), '5');
});

test('rejects malformed responses rather than silently showing older registrations as the latest', async () => {
  const invalid = [
    {}, { tx_responses: null, total: '0' }, { tx_responses: [], total: 'unknown' }, { tx_responses: [], total: [0] },
    history([tx(1, ['latest'], { code: undefined }), tx(2)]),
    history([tx(1, ['latest'], { txhash: 'not-a-cosmos-hash' }), tx(2)]),
    history([tx(1, ['latest'], { timestamp: null }), tx(2)]),
    history([tx(1, ['latest'], { timestamp: 'invalid' }), tx(2)]),
    history([tx(1, ['latest'], { height: '0' }), tx(2)]),
    history([tx(1, ['latest'], { height: ['999'] }), tx(2)]),
    history([tx(1, ['latest'], { events: null }), tx(2)]),
    history([tx(1, [], { events: [{ type: 'unrelated', attributes: [] }] }), tx(2)]),
    history([tx(1, [], { events: [{ type: 'xid_name_registered', attributes: null }] }), tx(2)]),
    history([tx(1, [], { events: [registration('', 'epix')] }), tx(2)]),
    history([tx(1, [], { events: [registration('latest', '')] }), tx(2)]),
    history([tx(1, [], { events: [registration('hello world')] }), tx(2)])
  ];
  for (const data of invalid) {
    const { rest, urls } = client(() => data);
    await assert.rejects(rest.latestRegistrations(), /invalid registration history/);
    assert.equal(urls.length, 1);
  }
});

test('rejects a repeated or empty page while the index still advertises more results', async () => {
  for (const second of [history([tx(1)], 5), history([], 5)]) {
    const { rest, urls } = client((url, call) => call === 1 ? history([tx(1)], 5) : second);
    await assert.rejects(rest.latestRegistrations(), /incomplete registration history/);
    assert.equal(urls.length, 2);
  }
});

test('bounds history work and reports unavailable results instead of returning a silently truncated list', async () => {
  const { rest, urls } = client((url, call) => history([tx(call, ['failed'], { code: 1 })], 100));
  await assert.rejects(rest.latestRegistrations(), /could not provide recent registrations/);
  assert.equal(urls.length, 5);
});

test('propagates network errors and rejects a non-success response for the retry UI', async () => {
  const network = client(() => { throw new Error('offline'); });
  await assert.rejects(network.rest.latestRegistrations(), /offline/);
  const rejected = client(() => history([]));
  rejected.rest.get = async () => ({ ok: false, status: 400, data: {} });
  await assert.rejects(rejected.rest.latestRegistrations(), /Could not load recent registrations/);
});
