const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ethers = require('../js/lib/ethers.umd.min.js');
const { h } = require('../js/lib/maquette.js');
const ZERO = '0x0000000000000000000000000000000000000000';
const OWNER_A = '0x1111111111111111111111111111111111111111';
const OWNER_B = '0x2222222222222222222222222222222222222222';

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(overrides = {}) {
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const context = {
    console, ethers, h,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    Page: { render() {}, nameUrl(tld, name) { return '?Name/' + tld + '/' + name; }, handleLinkClick() {} },
    Chain: { DEFAULT_TLD: 'epix' },
    Format: { ether: value => String(value), epix: value => String(value), tierLabel: value => String(value.max_length) },
    TxErrors: { extract: err => err.message || String(err) },
    Wallet: { isConnected: () => true, chainOk: true, handleConnectClick() {}, handleSwitchClick() {} },
    Rest: {
      namesAll: async () => ({ names: [], total: 0 }),
      reverse: async () => ({ ok: true, data: { primary_name: null } }),
      reverseIdentity: async () => ({ ok: true, data: { name_record: null, identity: null } }),
      tlds: async () => ({ ok: true, data: { tlds: [] } }),
      ...overrides.rest
    },
    XidContract: {
      ZERO,
      read: overrides.read || (async function (fn) { return fn === 'resolve' ? ZERO : fn === 'getProfile' ? ['', ''] : 10000n; })
    },
    TxState: class {
      constructor() { this.reset(); }
      reset() { this.status = 'idle'; this.errorText = ''; }
      get isBusy() { return this.status === 'pending'; }
      get isPending() { return this.isBusy; }
      get isConfirming() { return false; }
      get isSuccess() { return this.status === 'success'; }
      run(fn, args) { calls.push([fn, args]); this.status = 'pending'; }
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['utils/Text.js', 'utils/Bech32.js', 'pages/SearchPage.js', 'pages/RegisterPage.js', 'pages/PricesPage.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context, { filename: file });
  }
  return { c: context, calls, timers };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree].concat((tree.children || []).flatMap(nodes));
}
function text(tree) {
  return nodes(tree).map(node => node.text || '').join(' ');
}

test('name normalization accepts full names and enforces the chain label rules without truncation', () => {
  const { c } = setup();
  const valid = c.Text.nameInput('  My-Name.EPIX  ');
  assert.equal(valid.name, 'my-name');
  assert.equal(valid.tld, 'epix');
  assert.equal(valid.valid, true);
  for (const value of ['', 'hello world', '-name', 'name-', 'name..epix', 'name.other', 'café', 'a'.repeat(65)]) {
    assert.equal(c.Text.nameInput(value).valid, false, value);
  }
  assert.equal(c.Text.nameInput('a'.repeat(64)).valid, true);
  assert.equal(c.Text.nameInput('a'.repeat(65)).name.length, 65);
});

test('invalid input never starts a name lookup, registration quote, or fee query', async () => {
  let requests = 0;
  const { c } = setup({ read: async () => { requests++; } });
  const search = new c.SearchPage().name_search;
  search.input = 'hello world'; await search.lookup();
  const register = new c.RegisterPage();
  register.input = '-name'; await register.lookup();
  const prices = new c.PricesPage();
  prices.calcInput = 'name.other'; await prices.calculate();
  assert.equal(requests, 0);
  assert.ok(search.validation);
  assert.ok(register.validation);
  assert.ok(prices.validation);
});

test('name lookup retains a successful owner when optional fee or profile calls fail', async () => {
  const { c } = setup({ read: async fn => {
    if (fn === 'resolve') return OWNER_A;
    throw new Error('offline');
  } });
  const lookup = new c.SearchPage().name_search;
  lookup.input = 'one.epix'; await lookup.lookup();
  assert.equal(lookup.result.name, 'one');
  assert.equal(lookup.result.owner, OWNER_A);
  assert.equal(lookup.result.feeError, true);
  assert.equal(lookup.result.profileError, true);
  assert.equal(lookup.error, '');
  assert.match(text(lookup.render()), /Owner found, but the profile could not be loaded/);
});

test('name lookup shows failures and allows a successful retry', async () => {
  let fails = true;
  const { c } = setup({ read: async fn => {
    if (fails) throw new Error('offline');
    return fn === 'resolve' ? ZERO : fn === 'getProfile' ? ['', ''] : 10000n;
  } });
  const lookup = new c.SearchPage().name_search;
  lookup.input = 'one'; await lookup.lookup();
  assert.match(lookup.error, /offline/);
  assert.match(text(lookup.render()), /Try again/);
  fails = false; await lookup.lookup();
  assert.equal(lookup.error, '');
  const link = nodes(lookup.render()).find(node => node.properties?.href?.startsWith('?Register'));
  assert.equal(link.properties.href, '?Register&name=one');
});

test('an older name response cannot overwrite a newer result', async () => {
  const first = deferred(), second = deferred();
  const { c } = setup({ read: (fn, args) => fn === 'resolve' ? (args[0] === 'first' ? first.promise : second.promise) : Promise.resolve(fn === 'getProfile' ? ['', ''] : 10000n) });
  const lookup = new c.SearchPage().name_search;
  lookup.input = 'first'; const a = lookup.lookup();
  lookup.input = 'second'; const b = lookup.lookup();
  second.resolve(OWNER_B); await b;
  first.resolve(OWNER_A); await a;
  assert.equal(lookup.result.name, 'second');
  assert.equal(lookup.result.owner, OWNER_B);
});

test('editing a name invalidates its pending lookup before the debounce fires', async () => {
  const request = deferred();
  const { c } = setup({ read: fn => fn === 'resolve' ? request.promise : Promise.resolve(fn === 'getProfile' ? ['', ''] : 10000n) });
  const lookup = new c.SearchPage().name_search;
  lookup.input = 'first'; const pending = lookup.lookup();
  lookup.handleInput({ target: { value: 'second' } });
  request.resolve(OWNER_A); await pending;
  assert.equal(lookup.result, null);
  assert.equal(lookup.loading, false);
});

test('wallet lookup keeps all names and paginates with the primary name first', async () => {
  const names = Array.from({ length: 20 }, (_, index) => ({ name: 'name' + index, tld: 'epix' }));
  const { c } = setup({ rest: {
    namesAll: async () => ({ names, total: 20 }),
    reverse: async () => ({ ok: true, data: { primary_name: names[19] } })
  } });
  const lookup = new c.SearchPage().reverse;
  lookup.input = OWNER_A; await lookup.lookup();
  assert.equal(lookup.total, 20);
  assert.equal(lookup.names.length, 20);
  assert.equal(lookup.names[0].name, 'name19');
  const renderedNames = () => nodes(lookup.render()).filter(node => node.properties?.href?.startsWith('?Name'));
  assert.equal(renderedNames().length, 10);
  lookup.next();
  assert.equal(lookup.page, 1);
  assert.equal(renderedNames().length, 10);
  assert.match(text(lookup.render()), /11–20 of 20/);
});

test('wallet lookup rejects malformed bech32 before contacting the chain', async () => {
  let requests = 0;
  const { c } = setup({ rest: { namesAll: async () => { requests++; return { names: [], total: 0 }; } } });
  const lookup = new c.SearchPage().reverse;
  lookup.input = 'epix1notavalidaddress'; await lookup.lookup();
  assert.equal(requests, 0);
  assert.match(lookup.error, /valid checksum/);
});

test('wallet lookup ignores an old response after another wallet is submitted', async () => {
  const first = deferred(), second = deferred();
  const { c } = setup();
  c.Rest.namesAll = address => address === c.Bech32.evmToBech32(OWNER_A) ? first.promise : second.promise;
  const lookup = new c.SearchPage().reverse;
  lookup.input = OWNER_A; const a = lookup.lookup();
  lookup.input = OWNER_B; const b = lookup.lookup();
  second.resolve({ names: [{ name: 'second', tld: 'epix' }], total: 1 }); await b;
  first.resolve({ names: [{ name: 'first', tld: 'epix' }], total: 1 }); await a;
  assert.equal(lookup.address, OWNER_B);
  assert.equal(lookup.names[0].name, 'second');
});

test('identity lookup uses the actual identity field and preserves revoked metadata', async () => {
  const { c } = setup({ rest: { reverseIdentity: async () => ({ ok: true, data: {
    name_record: { name: 'one', tld: 'epix', owner: OWNER_A },
    identity: { active: false, label: 'old laptop', added_at: '123', revoked_at: '456' }
  } }) } });
  const lookup = new c.SearchPage().identity;
  lookup.input = c.Bech32.evmToBech32(OWNER_A); await lookup.lookup();
  assert.equal(lookup.result.active, false);
  assert.equal(lookup.result.label, 'old laptop');
  assert.equal(lookup.result.addedAt, '123');
  assert.equal(lookup.result.revokedAt, '456');
  assert.match(text(lookup.render()), /Revoked/);
});

test('identity lookup does not label missing status as active, and ignores stale completions', async () => {
  const first = deferred(), second = deferred();
  const { c } = setup();
  const a32 = c.Bech32.evmToBech32(OWNER_A), b32 = c.Bech32.evmToBech32(OWNER_B);
  c.Rest.reverseIdentity = address => address === a32 ? first.promise : second.promise;
  const lookup = new c.SearchPage().identity;
  lookup.input = a32; const a = lookup.lookup();
  lookup.input = b32; const b = lookup.lookup();
  second.resolve({ ok: true, data: { name_record: { name: 'second', tld: 'epix' }, identity: null } }); await b;
  first.resolve({ ok: true, data: { name_record: { name: 'first', tld: 'epix' }, identity: { active: true } } }); await a;
  assert.equal(lookup.result.name, 'second');
  assert.equal(lookup.result.active, null);
  assert.match(text(lookup.render()), /Status unavailable/);
});

test('registration only submits the validated name that matches the displayed quote', async () => {
  const { c, calls } = setup();
  const page = new c.RegisterPage();
  page.input = ' One.EPIX '; await page.lookup();
  assert.equal(page.name, 'one');
  assert.equal(page.canRegister(), true);
  page.handleInput({ target: { value: 'two' } });
  assert.equal(page.canRegister(), false);
  page.handleRegister();
  assert.equal(calls.length, 0);
  await page.lookup(); page.handleRegister();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'register');
  assert.equal(calls[0][1][0], 'two');
});

test('registration does not enable submitting when the fee is unavailable', async () => {
  const { c, calls } = setup({ read: async fn => { if (fn === 'resolve') return ZERO; throw new Error('offline'); } });
  const page = new c.RegisterPage();
  page.input = 'one'; await page.lookup();
  assert.equal(page.isAvailable, true);
  assert.match(page.error, /registration fee could not be loaded/);
  assert.equal(page.canRegister(), false);
  page.handleRegister();
  assert.equal(calls.length, 0);
});

test('confirmed registration stays visible when the follow-up availability read is slow or fails', () => {
  const { c } = setup();
  const page = new c.RegisterPage();
  page.input = page.name = page.registeredName = 'one';
  page.tx.status = 'success';
  page.tx.hash = '0xreceipt';
  page.tx.explorerUrl = 'https://example.test/tx/0xreceipt';
  for (const loading of [true, false]) {
    page.resolving = loading;
    page.error = loading ? '' : 'Availability service is offline';
    const result = page.render();
    assert.match(text(result), /one.epix is yours/);
    assert.match(text(result), /Manage your name/);
    assert.ok(nodes(result).some(node => node.properties?.href === page.tx.explorerUrl));
  }
});

test('search and pricing registration links preserve the normalized name through route prefill', async () => {
  const { c } = setup();
  const lookup = new c.SearchPage().name_search;
  lookup.input = ' My-Name.EPIX '; await lookup.lookup();
  const prices = new c.PricesPage();
  prices.calcInput = ' My-Name.EPIX '; await prices.calculate();
  for (const tree of [lookup.render(), prices.render()]) {
    const link = nodes(tree).find(node => node.properties?.href?.startsWith('?Register'));
    assert.ok(link);
    const route = c.Text.queryParse(link.properties.href.slice(1));
    assert.equal(route.urls[0], 'Register');
    const register = new c.RegisterPage();
    await register.enter(route.name);
    assert.equal(register.input, 'my-name');
    assert.equal(register.name, 'my-name');
    assert.equal(register.quotedName, 'my-name');
    assert.equal(register.canRegister(), true);
  }
});

test('clearing registration or pricing invalidates pending responses and loading state', async () => {
  const quote = deferred();
  const { c } = setup({ read: fn => fn === 'resolve' ? Promise.resolve(ZERO) : quote.promise });
  const register = new c.RegisterPage();
  const prices = new c.PricesPage();
  register.input = 'one'; const a = register.lookup();
  prices.calcInput = 'one'; const b = prices.calculate();
  register.handleInput({ target: { value: '' } });
  prices.handleCalcInput({ target: { value: '' } });
  quote.resolve(10000n); await Promise.all([a, b]);
  assert.equal(register.fee, null);
  assert.equal(register.resolving, false);
  assert.equal(prices.calcFee, null);
  assert.equal(prices.calcLoading, false);
});

test('all lookup, registration, and pricing actions render as native buttons', () => {
  const { c } = setup();
  const search = new c.SearchPage();
  const roots = [search.render(), search.reverse.render(), search.identity.render(), new c.RegisterPage().render(), new c.PricesPage().render()];
  const all = roots.flatMap(nodes);
  assert.ok(all.filter(node => node.vnodeSelector?.startsWith('button')).length >= 7);
  assert.equal(all.filter(node => node.vnodeSelector?.startsWith('a') && /^#/.test(node.properties?.href || '')).length, 0);
  assert.ok(all.some(node => node.properties?.['aria-live'] === 'polite'));
});
