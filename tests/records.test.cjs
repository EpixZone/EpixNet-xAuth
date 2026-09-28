const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ethers = require('../js/lib/ethers.umd.min.js');
const { h } = require('../js/lib/maquette.js');

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const EPIXNET = 65280;

function setup(options = {}) {
  const simulations = [];
  let signerCalls = 0;
  const context = {
    ethers, h, URL, TextEncoder, Intl, Date, setTimeout, clearTimeout,
    Page: { render() {}, handleLinkClick() {}, auth_address: null },
    Chain: {
      DEFAULT_TLD: 'epix',
      withRpc: async callback => callback({ call: async request => {
        simulations.push(request);
        if (options.simulate) return options.simulate(request);
        // This suite ends at the real ABI/preflight boundary. Nothing is sent.
        throw new Error('Simulation stopped for test');
      } })
    },
    Wallet: { address: OWNER, signer: async () => { signerCalls++; throw new Error('Signing is forbidden in this test'); } },
    Rest: { dns: options.dns || (async () => ({ ok: true, data: { records: [] } })) }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['utils/Bech32.js', 'utils/Format.js', 'utils/Text.js', 'wallet/TxErrors.js', 'wallet/XidContract.js', 'wallet/TxState.js', 'pages/NameDetailPage.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context, { filename: file });
  }
  const page = new context.NameDetailPage();
  page.name = 'alice';
  page.tld = 'epix';
  page.owner = OWNER;
  page.dns.loading = false;
  let pending;
  const run = page.dns.setTx.run.bind(page.dns.setTx);
  page.dns.setTx.run = (...args) => { pending = run(...args); return pending; };
  return {
    c: context, page, dns: page.dns, simulations,
    address: context.Bech32.evmToBech32(OTHER),
    pending: () => pending,
    signerCalls: () => signerCalls
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree].concat((tree.children || []).flatMap(nodes));
}

function text(tree) { return nodes(tree).map(node => node.text || '').join(' '); }

function byId(tree, id) { return nodes(tree).find(node => node.properties?.id === id); }

test('EpixNet values normalize copied local and gateway URLs to the raw xite address', () => {
  const { c, address } = setup();
  for (const input of [address, ` ${address} `, `http://127.0.0.1:43110/${address}/index.html?view=1#title`, `https://gateway.example/${address}/`, `/${address}/page.html`]) {
    assert.equal(c.XidContract.xiteAddress(input), address, input);
    const result = c.XidContract.recordValue(EPIXNET, input);
    assert.equal(result.error, '');
    assert.equal(result.value, address);
  }
});

test('EpixNet records reject checksum failures, EVM addresses and unsupported URL schemes', () => {
  const { c, address } = setup();
  const badChecksum = address.slice(0, -1) + (address.endsWith('q') ? 'p' : 'q');
  const wrongPrefix = c.Bech32.encode('cosmos', new Uint8Array(20));
  const wrongLength = c.Bech32.encode('epix', new Uint8Array(32));
  for (const input of ['', OWNER, badChecksum, wrongPrefix, wrongLength, `https://gateway.example/${badChecksum}/`, `ftp://gateway.example/${address}`, `javascript:${address}`]) {
    assert.equal(c.XidContract.xiteAddress(input), null, input);
    assert.match(c.XidContract.recordValue(EPIXNET, input).error, /valid epix1/);
  }
});

test('native browser and epix links use the xite hostname before any address-shaped page path', () => {
  const { c, address } = setup();
  const otherAddress = c.Bech32.evmToBech32(OWNER);
  for (const input of [
    `https://${address}.epix/`,
    `http://${address}.epix/page.html?view=1#title`,
    `https://${address}/${otherAddress}/`,
    `https://${address}.epix/${otherAddress}/`,
    `epix://${address}/page.html`,
    `epix://${address}.epix/${otherAddress}/`
  ]) {
    assert.equal(c.XidContract.xiteAddress(input), address, input);
    assert.equal(c.XidContract.recordValue(EPIXNET, input).value, address, input);
  }
});

test('invalid native hosts cannot fall back to an unrelated address in their page path', () => {
  const { c, address } = setup();
  const badChecksum = address.slice(0, -1) + (address.endsWith('q') ? 'p' : 'q');
  for (const input of [
    `https://${badChecksum}.epix/${address}/`,
    `https://${badChecksum}/${address}/`,
    `https://alice.epix/${address}/`,
    `epix://${badChecksum}/${address}/`,
    `epix://gateway.example/${address}/`
  ]) {
    assert.equal(c.XidContract.xiteAddress(input), null, input);
    assert.ok(c.XidContract.recordValue(EPIXNET, input).error, input);
  }
});

test('record validation preserves exact TXT data and enforces byte and IP limits', () => {
  const { c } = setup();
  assert.equal(c.XidContract.recordValue(16, ' verification=abc ').value, ' verification=abc ');
  assert.equal(c.XidContract.recordValue(16, 'é'.repeat(512)).error, '');
  assert.match(c.XidContract.recordValue(16, 'é'.repeat(513)).error, /1,024 bytes/);
  assert.match(c.XidContract.recordValue(16, '   ').error, /Enter a value/);
  assert.equal(c.XidContract.recordValue(1, ' 93.184.216.34 ').value, '93.184.216.34');
  for (const input of ['256.0.0.1', '1.2.3', 'https://1.2.3.4']) assert.ok(c.XidContract.recordValue(1, input).error, input);
  assert.equal(c.XidContract.recordValue(28, '2001:db8::1').error, '');
  assert.ok(c.XidContract.recordValue(28, '2001:::invalid').error);
});

test('TTL accepts the default or inclusive chain bounds without silently clamping', () => {
  const { c } = setup();
  for (const value of ['0', '60', '3600', '604800', 0, 60, 604800]) assert.equal(c.XidContract.recordTtlError(value), '', String(value));
  for (const value of ['', ' ', '-1', '1', '59', '604801', '60.5', 'Infinity', 'not a number']) assert.match(c.XidContract.recordTtlError(value), /60 to 604800/, String(value));
});

test('the editor opens with EpixNet first, associated labels and contextual guidance', () => {
  const { c, dns } = setup();
  assert.equal(c.XidContract.DNS_RECORD_TYPES[0].type, EPIXNET);
  dns.handleToggle();
  assert.equal(dns.showAdd, true);
  assert.equal(dns.recordType, EPIXNET);
  const form = dns.renderForm();
  const select = byId(form, 'dns-type');
  assert.equal(select.properties.value, String(EPIXNET));
  assert.match(text(select.children[0]), /EpixNet xite/);
  for (const id of ['dns-type', 'dns-value', 'dns-ttl']) {
    assert.ok(byId(form, id));
    assert.ok(nodes(form).some(node => node.vnodeSelector === 'label.field' && node.properties.for === id));
  }
  assert.match(text(form), /Copy its epix1/);
  assert.match(text(form), /wallet address and linked login identity have different roles/);
  assert.equal(byId(form, 'dns-value').properties['aria-describedby'], 'dns-value-help dns-value-error');
  const save = nodes(form).find(node => node.vnodeSelector.startsWith('button') && text(node) === 'Save xite address');
  assert.equal(save.properties.disabled, true);
});

test('editing an existing type preloads its value and explains replacement', () => {
  const { dns, address } = setup();
  dns.records = [
    { record_type: '65280', value: address, ttl: '7200' },
    { record_type: 16, value: 'verification=keep-this', ttl: '60' }
  ];
  dns.handleToggle();
  assert.equal(dns.recordValue, address);
  assert.equal(dns.recordTTL, '7200');
  assert.match(text(dns.renderForm()), /Saving replaces the existing EPIXNET value/);
  assert.match(text(dns.renderForm()), /one record per type/);
  dns.handleEditClick({ currentTarget: { getAttribute: () => '16' } });
  assert.equal(dns.recordType, 16);
  assert.equal(dns.recordValue, 'verification=keep-this');
  assert.equal(dns.recordTTL, '60');
  assert.match(text(dns.renderForm()), /Update record/);
  dns.handleTypeChange({ target: { value: '1' } });
  assert.equal(dns.recordValue, '');
  assert.equal(dns.recordTTL, '3600');
});

test('saving a xite URL simulates the correct ABI payload with the plain address', async () => {
  const { c, dns, address, simulations, pending, signerCalls } = setup();
  dns.showAdd = true;
  dns.recordValue = `http://127.0.0.1:43110/${address}/index.html?wrapper=False`;
  dns.recordTTL = '3600';
  assert.equal(dns.handleAdd(), false);
  await pending();
  assert.equal(simulations.length, 1);
  assert.equal(simulations[0].to, c.XidContract.ADDRESS);
  assert.equal(simulations[0].from, OWNER);
  const args = c.XidContract.interface().decodeFunctionData('setDNSRecord', simulations[0].data);
  assert.deepEqual(Array.from(args), ['alice', 'epix', 65280n, address, 3600n]);
  assert.equal(signerCalls(), 0);
});

test('invalid input, unavailable records, or lost ownership never reach a simulation', () => {
  const { page, dns, address, simulations, signerCalls } = setup();
  const cases = [
    () => { dns.recordValue = OWNER; },
    () => { dns.recordTTL = '59'; },
    () => { dns.recordTTL = '604801'; },
    () => { dns.recordTTL = ''; },
    () => { dns.recordType = 1; dns.recordValue = '999.1.2.3'; },
    () => { dns.loading = true; },
    () => { dns.error = 'Failed to load'; },
    () => { dns.setTx.status = 'simulating'; },
    () => { page.owner = OTHER; }
  ];
  for (const change of cases) {
    dns.recordType = EPIXNET;
    dns.recordValue = address;
    dns.recordTTL = '3600';
    dns.loading = false;
    dns.error = '';
    dns.setTx.reset();
    page.owner = OWNER;
    change();
    assert.equal(dns.handleAdd(), false);
  }
  assert.equal(simulations.length, 0);
  assert.equal(signerCalls(), 0);
});

test('chain validation errors stay visible without a transaction hash or wallet prompt', async () => {
  const reason = 'DNS record rejected by the chain';
  const revert = '0x08c379a0' + ethers.AbiCoder.defaultAbiCoder().encode(['string'], [reason]).slice(2);
  const { dns, address, pending, signerCalls } = setup({ simulate: async () => {
    throw { shortMessage: 'missing revert data', info: { error: { data: revert } } };
  } });
  dns.showAdd = true;
  dns.recordValue = address;
  dns.handleAdd();
  await pending();
  assert.equal(dns.setTx.status, 'error');
  assert.equal(dns.setTx.hash, null);
  assert.equal(dns.setTx.errorText, reason);
  assert.match(text(dns.render()), new RegExp(reason));
  assert.equal(dns.recordValue, address);
  assert.equal(dns.showAdd, true);
  assert.equal(signerCalls(), 0);
});

test('saving and deleting records cannot overlap while either transaction is pending', () => {
  const { dns, address, simulations, signerCalls } = setup();
  dns.showAdd = true;
  dns.recordValue = address;
  dns.recordTTL = '3600';
  dns.delTx.status = 'confirming';
  assert.equal(dns.handleAdd(), false);
  const save = nodes(dns.renderForm()).find(node => node.vnodeSelector.startsWith('button') && text(node) === 'Save xite address');
  assert.equal(save.properties.disabled, true);

  dns.delTx.reset();
  dns.setTx.status = 'pending';
  assert.equal(dns.del(EPIXNET), false);
  assert.equal(dns.delTx.status, 'idle');
  assert.equal(simulations.length, 0);
  assert.equal(signerCalls(), 0);
});

test('records load errors show a retry rather than an empty-state success', async () => {
  let calls = 0;
  const { dns, address } = setup({ dns: async (tld, name) => {
    assert.equal(tld, 'epix');
    assert.equal(name, 'alice');
    calls++;
    return calls === 1 ? { ok: false, status: 503 } : { ok: true, data: { records: [{ record_type: EPIXNET, value: address, ttl: '3600' }] } };
  } });
  await dns.fetchRecords();
  assert.match(dns.error, /Could not load records/);
  const failed = dns.render();
  assert.doesNotMatch(text(failed), /No xite destination or other records yet/);
  const retry = nodes(failed).find(node => node.vnodeSelector.startsWith('button') && text(node) === 'Retry');
  assert.ok(retry);
  await retry.properties.onclick();
  assert.equal(dns.error, '');
  assert.equal(dns.records.length, 1);
  assert.match(text(dns.render()), new RegExp(address));
});

test('wallet changes clear the editor and ignore late transaction status and success callbacks', async () => {
  let finishOldWrite, notifyOldWrite, reads = 0;
  const oldWrite = new Promise(resolve => { finishOldWrite = resolve; });
  const { c, page, dns, address, pending } = setup({ dns: async () => {
    reads++;
    return { ok: true, data: { records: [{ record_type: 16, value: 'current-record', ttl: '3600' }] } };
  } });
  c.XidContract.read = async () => ['', ''];
  c.XidContract.write = (fn, args, notify) => { notifyOldWrite = notify; return oldWrite; };
  dns.showAdd = true;
  dns.recordValue = address;
  dns.handleAdd();
  assert.equal(dns.setTx.isBusy, true);
  c.Wallet.address = OTHER;
  page.onWalletChanged();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dns.showAdd, false);
  assert.equal(dns.recordValue, '');
  assert.equal(dns.setTx.status, 'idle');
  assert.equal(dns.setTx.hash, null);
  assert.equal(reads, 1);

  notifyOldWrite('success', '0x' + 'ab'.repeat(32));
  finishOldWrite({ status: 1 });
  await pending();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dns.setTx.status, 'idle');
  assert.equal(dns.setTx.hash, null);
  assert.equal(dns.records[0].value, 'current-record');
  assert.equal(reads, 1, 'the old success callback must not refresh records in the new account state');
});
