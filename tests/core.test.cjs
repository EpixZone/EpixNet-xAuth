const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ethers = require('../js/lib/ethers.umd.min.js');
const maquette = require('../js/lib/maquette.js');
const OWNER_A = '0x1111111111111111111111111111111111111111';
const OWNER_B = '0x2222222222222222222222222222222222222222';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function harness() {
  const timers = new Map();
  let timerId = 0;
  const c = {
    console, URL, URLSearchParams, AbortController, ethers, maquette, h: maquette.h,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    Chain: { DEFAULT_TLD: 'epix', ID: 1916, DEFAULT_REST: 'https://node.example', restUrls: ['https://node.example'], evmTxUrl: hash => '/tx/' + hash, explorerTxUrl: hash => '/cosmos/' + hash },
    Wallet: { address: OWNER_A, isConnected() { return !!this.address; }, renderButton: () => maquette.h('button', 'Connect') },
    Page: { render() {}, onWalletChanged() {}, nameUrl: (tld, name) => '?Name/' + tld + '/' + name, handleLinkClick() {} },
    TxErrors: { extract: error => error.message || String(error) },
    Icons: new Proxy({}, { get: () => () => maquette.h('span') }),
    Format: { block: String, ether: String },
    XidContract: { ZERO: '0x0000000000000000000000000000000000000000', peersFrom: () => [], DNS_RECORD_TYPES: [] },
    Rest: { cosmosTxHash: async () => 'cosmos-hash' },
    fetch: async () => { throw new Error('Unmocked network request'); }
  };
  c.window = c;
  vm.createContext(c);
  const load = relative => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', relative), 'utf8'), c, { filename: relative });
  load('utils/Text.js');
  load('utils/Bech32.js');
  load('wallet/TxState.js');
  return { c, load, timers };
}
function nodes(tree) {
  return tree && typeof tree === 'object' ? [tree].concat((tree.children || []).flatMap(nodes)) : [];
}
function renderedText(tree) { return nodes(tree).map(node => node.text || '').join(' '); }
function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => data };
}

test('standalone Back updates routing state so the last navigation item works again', () => {
  const { c, load } = harness();
  const events = {}, pushes = [];
  let entries = 0;
  c.EpixFrame = class {};
  c.addEventListener = (type, handler) => { events[type] = handler; };
  c.location = { search: '?' };
  c.history = { pushState(state, title, url) { pushes.push({ state: { ...state }, url }); c.location.search = url; } };
  c.scrollTo = () => {};
  load('XidApp.js');
  const app = c.Page;
  app.projector = { scheduleRender() {} };
  app.history_state = {};
  app.pages = { register: {}, search: {}, my_names: { enter() { entries++; } } };
  app.content = app.pages.register;
  app.navigate('?Search');
  app.navigate('?MyNames');
  c.location.search = '?Search';
  events.popstate({ state: { url: 'Search' } });
  assert.equal(app.content, app.pages.search);
  assert.equal(app.history_state.url, 'Search');
  let prevented = false;
  app.handleLinkClick({ currentTarget: { getAttribute: () => '?MyNames' }, preventDefault() { prevented = true; }, button: 0 });
  assert.equal(app.content, app.pages.my_names);
  assert.equal(c.location.search, '?MyNames');
  assert.equal(app.history_state.url, 'MyNames');
  assert.equal(entries, 2);
  assert.equal(pushes.length, 3);
  assert.equal(prevented, true);
});

test('namesAll follows encoded cursors when the server caps each requested page at ten names', async () => {
  const { c, load } = harness();
  load('utils/Rest.js');
  const names = Array.from({ length: 20 }, (_, index) => ({ name: 'name' + index, tld: 'epix', owner: 'epix1owner' }));
  const urls = [];
  const cursor = 'cursor+/=';
  c.fetch = async url => {
    urls.push(url);
    const query = new URL(url).searchParams;
    assert.equal(query.get('pagination.limit'), '100');
    assert.equal(query.get('pagination.count_total'), 'true');
    if (urls.length === 1) {
      assert.equal(query.get('pagination.key'), null);
      return response({ names: names.slice(0, 10), pagination: { next_key: cursor, total: '20' } });
    }
    assert.equal(query.get('pagination.key'), cursor);
    return response({ names: names.slice(10), pagination: { next_key: null, total: '0' } });
  };
  const result = await c.Rest.namesAll('epix1owner');
  assert.equal(urls.length, 2);
  assert.match(urls[1], /pagination.key=cursor%2B%2F%3D/);
  assert.equal(result.names.length, 20);
  assert.equal(result.names[19].name, 'name19');
  assert.equal(result.total, 20);
});

test('namesAll rejects a repeated cursor instead of returning partial data or looping', async () => {
  const { c, load } = harness();
  load('utils/Rest.js');
  let requests = 0;
  c.fetch = async () => {
    requests++;
    return response({ names: [{ name: 'one', tld: 'epix' }], pagination: { next_key: 'same-cursor', total: '20' } });
  };
  await assert.rejects(c.Rest.namesAll('epix1owner'), /list changed while loading/);
  assert.equal(requests, 2);
});

test('namesAll rejects malformed responses rather than reporting a wallet with no names', async () => {
  const { c, load } = harness();
  load('utils/Rest.js');
  for (const data of [{}, { names: null }, { names: {} }, null]) {
    c.fetch = async () => response(data);
    await assert.rejects(c.Rest.namesAll('epix1owner'), /Could not load|unreadable response/);
  }
  c.fetch = async () => ({ ...response(null), json: async () => { throw new Error('bad JSON'); } });
  await assert.rejects(c.Rest.namesAll('epix1owner'), /unreadable response/);
});

test('My Names displays a rejected transaction before any hash exists', async () => {
  const { c, load } = harness();
  load('pages/MyNamesPage.js');
  c.XidContract.write = async () => { throw new Error('User rejected request'); };
  const page = new c.MyNamesPage();
  page.names = [{ name: 'one', tld: 'epix' }];
  page.total = 1;
  page.setPrimary(page.names[0]);
  await tick();
  assert.equal(page.tx.hash, null);
  assert.equal(page.tx.status, 'error');
  assert.match(renderedText(page.render()), /User rejected request/);
});

test('My Names ignores the previous wallet response after the connected account changes', async () => {
  const { c, load } = harness();
  load('pages/MyNamesPage.js');
  const first = deferred(), second = deferred();
  const firstAddress = c.Bech32.evmToBech32(OWNER_A);
  c.Rest.namesPage = address => address === firstAddress ? first.promise : second.promise;
  c.XidContract.read = async (method, args) => [args[0] === OWNER_A ? 'first' : 'second', 'epix'];
  const page = new c.MyNamesPage();
  c.Page.content = page;
  page.enter();
  c.Wallet.address = OWNER_B;
  page.onWalletChanged();
  second.resolve({ names: [{ name: 'second', tld: 'epix' }], total: 1 });
  await tick();
  first.resolve({ names: [{ name: 'first', tld: 'epix' }], total: 99 });
  await tick();
  assert.equal(page.names[0].name, 'second');
  assert.equal(page.total, 1);
  assert.equal(page.primaryName, 'second');
  assert.equal(page.loading, false);
});

test('Name Detail ignores the old owner response after navigating to a different name', async () => {
  const { c, load } = harness();
  load('pages/NameDetailPage.js');
  const first = deferred(), second = deferred();
  c.XidContract.read = (method, args) => {
    if (method === 'resolve') return args[0] === 'first' ? first.promise : second.promise;
    if (method === 'getContentRoot') return Promise.resolve(['', 0n]);
    if (method === 'getLinkedIdentities') return Promise.resolve([[], [], [], [], [], []]);
    return Promise.resolve(['', '']);
  };
  c.Rest.dns = async () => ({ ok: true, data: { records: [] } });
  const page = new c.NameDetailPage();
  page.enter('epix', 'first', null);
  page.enter('epix', 'second', null);
  second.resolve(OWNER_B); await tick();
  first.resolve(OWNER_A); await tick();
  assert.equal(page.name, 'second');
  assert.equal(page.owner, OWNER_B);
  assert.equal(page.isOwner(), false);
  assert.equal(page.resolveLoading, false);
});

test('TxState ignores progress and successful completion from an operation that was reset', async () => {
  const { c } = harness();
  const writes = [];
  c.XidContract.write = (method, args, notify) => {
    const pending = deferred();
    writes.push({ ...pending, notify });
    return pending.promise;
  };
  const state = new c.TxState();
  let oldSuccess = 0, newSuccess = 0;
  const first = state.run('register', ['first', 'epix'], () => { oldSuccess++; });
  state.reset();
  const second = state.run('register', ['second', 'epix'], () => { newSuccess++; });
  writes[0].notify('success', 'old-hash');
  writes[0].resolve({ status: 1 });
  await first;
  assert.equal(state.status, 'simulating');
  assert.equal(state.hash, null);
  assert.equal(oldSuccess, 0);
  writes[1].notify('success', 'new-hash');
  writes[1].resolve({ status: 1 });
  await second;
  assert.equal(state.status, 'success');
  assert.equal(state.hash, 'new-hash');
  assert.equal(newSuccess, 1);
});

test('TxState does not restore a rejected operation error after reset', async () => {
  const { c } = harness();
  const request = deferred();
  c.XidContract.write = () => request.promise;
  const state = new c.TxState();
  const pending = state.run('register', ['one', 'epix']);
  state.reset();
  request.reject(new Error('Old wallet rejected'));
  await pending;
  assert.equal(state.status, 'idle');
  assert.equal(state.errorText, null);
  assert.equal(state.hash, null);
});

function fakeWalletProvider() {
  const handlers = {};
  let requests = 0, chain = '0x77c';
  return {
    handlers,
    get requests() { return requests; },
    set chain(value) { chain = value; },
    request: async ({ method }) => {
      requests++;
      if (method === 'eth_chainId') return chain;
      throw new Error('Unexpected wallet request: ' + method);
    },
    on(event, handler) { handlers[event] = handler; }
  };
}

test('Wallet ignores old provider events after disconnect instead of recreating a null provider', async () => {
  const { c, load } = harness();
  c.Chain.withRpc = async fn => fn({ getBalance: async () => 0n });
  let changes = 0;
  c.Page.onWalletChanged = () => { changes++; };
  load('wallet/Wallet.js');
  const provider = fakeWalletProvider();
  await c.Wallet.onConnected({ provider, address: OWNER_A });
  c.Wallet.disconnect();
  const requestCount = provider.requests, changeCount = changes;
  assert.doesNotThrow(() => provider.handlers.chainChanged('0x1'));
  provider.handlers.accountsChanged([OWNER_B]);
  await tick();
  assert.equal(c.Wallet.address, null);
  assert.equal(c.Wallet.raw, null);
  assert.equal(c.Wallet.browserProvider, null);
  assert.equal(provider.requests, requestCount);
  assert.equal(changes, changeCount);
});

test('Wallet ignores events from an old extension when a different provider is connected', async () => {
  const { c, load } = harness();
  c.Chain.withRpc = async fn => fn({ getBalance: async () => 0n });
  load('wallet/Wallet.js');
  const first = fakeWalletProvider(), second = fakeWalletProvider();
  await c.Wallet.onConnected({ provider: first, address: OWNER_A });
  await c.Wallet.onConnected({ provider: second, address: OWNER_B });
  const activeProvider = c.Wallet.browserProvider;
  first.handlers.accountsChanged([]);
  first.handlers.chainChanged('0x1');
  await tick();
  assert.equal(c.Wallet.raw, second);
  assert.equal(c.Wallet.address, OWNER_B);
  assert.equal(c.Wallet.browserProvider, activeProvider);
});

test('Wallet chain checks follow a wrong-network and return-to-Epix sequence', async () => {
  const { c, load } = harness();
  c.Chain.withRpc = async fn => fn({ getBalance: async () => 0n });
  load('wallet/Wallet.js');
  const provider = fakeWalletProvider();
  await c.Wallet.onConnected({ provider, address: OWNER_A });
  assert.equal(c.Wallet.chainOk, true);
  provider.chain = '0x1'; await c.Wallet.checkChain();
  assert.equal(c.Wallet.chainOk, false);
  provider.chain = '0x77c'; await c.Wallet.checkChain();
  assert.equal(c.Wallet.chainOk, true);
});

test('RPC providers preserve the fifteen-second deadline with the bundled ethers version', async () => {
  const { c, load } = harness();
  load('wallet/Chain.js');
  c.Chain.init({ chain_evm_rpc_urls: ['https://first.invalid', 'https://second.invalid'] });
  try {
    const first = c.Chain.provider(0);
    assert.equal(first, c.Chain.provider(0));
    assert.equal(first._getConnection().timeout, 15000);
    assert.equal(first._getConnection().url, 'https://first.invalid');
    assert.equal((await first.getNetwork()).chainId, 1916n);
    assert.equal(c.Chain.provider(1)._getConnection().timeout, 15000);
  } finally {
    Object.values(c.Chain.providers).forEach(provider => provider.destroy());
  }
});

test('RPC timeout fails over to the next provider and retains that healthy provider', async () => {
  const { c, load } = harness();
  load('wallet/Chain.js');
  c.Chain.init({ chain_evm_rpc_urls: ['https://first.invalid', 'https://second.invalid'] });
  const visited = [];
  try {
    const value = await c.Chain.withRpc(async provider => {
      const url = provider._getConnection().url;
      visited.push(url);
      if (url === 'https://first.invalid') throw Object.assign(new Error('Request timed out'), { code: 'TIMEOUT' });
      return 42;
    });
    assert.equal(value, 42);
    assert.deepEqual(visited, ['https://first.invalid', 'https://second.invalid']);
    assert.equal(c.Chain.evmIndex, 1);
    await c.Chain.withRpc(async provider => { assert.equal(provider._getConnection().url, 'https://second.invalid'); });
  } finally {
    Object.values(c.Chain.providers).forEach(provider => provider.destroy());
  }
});

test('concurrent RPC success cannot make another timed-out request skip the healthy endpoint', async () => {
  const { c, load } = harness();
  load('wallet/Chain.js');
  c.Chain.init({ chain_evm_rpc_urls: ['https://first.invalid', 'https://second.invalid'] });
  const delayed = deferred();
  const timeout = Object.assign(new Error('Request timed out'), { code: 'TIMEOUT' });
  const slowVisits = [];
  try {
    const slow = c.Chain.withRpc(provider => {
      const url = provider._getConnection().url;
      slowVisits.push(url);
      if (url === 'https://second.invalid') return Promise.resolve('slow recovered');
      return slowVisits.length === 1 ? delayed.promise : Promise.reject(timeout);
    });
    const fast = await c.Chain.withRpc(provider => provider._getConnection().url === 'https://first.invalid' ? Promise.reject(timeout) : Promise.resolve('fast recovered'));
    assert.equal(fast, 'fast recovered');
    assert.equal(c.Chain.evmIndex, 1);
    delayed.reject(timeout);
    assert.equal(await slow, 'slow recovered');
    assert.deepEqual(slowVisits, ['https://first.invalid', 'https://second.invalid']);
  } finally {
    Object.values(c.Chain.providers).forEach(provider => provider.destroy());
  }
});

test('concurrent REST success cannot make another failed request repeat the first endpoint', async () => {
  const { c, load } = harness();
  load('utils/Rest.js');
  c.Chain.restUrls = ['https://first.invalid', 'https://second.invalid'];
  const delayed = deferred();
  const slowVisits = [];
  c.fetch = async address => {
    const url = new URL(address);
    if (url.pathname === '/slow') {
      slowVisits.push(url.origin);
      if (url.hostname === 'second.invalid') return response({ result: 'slow recovered' });
      if (slowVisits.length === 1) return delayed.promise;
      throw new TypeError('Connection failed');
    }
    if (url.hostname === 'first.invalid') throw new TypeError('Connection failed');
    return response({ result: 'fast recovered' });
  };
  const slow = c.Rest.get('/slow');
  const fast = await c.Rest.get('/fast');
  assert.equal(fast.data.result, 'fast recovered');
  assert.equal(c.Rest.index, 1);
  delayed.reject(new TypeError('Connection timed out'));
  assert.equal((await slow).data.result, 'slow recovered');
  assert.deepEqual(slowVisits, ['https://first.invalid', 'https://second.invalid']);
});
