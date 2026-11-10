const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ethers = require('../js/lib/ethers.umd.min.js');

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const UNIT = 10n ** 18n;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const calls = { signers: 0, sends: 0, simulations: 0, estimates: 0, quotes: 0 };
  const provider = {
    getBalance: async () => 20000n * UNIT,
    estimateGas: async () => { calls.estimates++; return 100000n; },
    getFeeData: async () => ({ maxFeePerGas: 1000000000n, gasPrice: 1n }),
    call: async () => { calls.simulations++; return '0x'; }
  };
  const c = {
    console, setTimeout, clearTimeout, URL, TextEncoder,
    document: { addEventListener() {} },
    Chain: { ID: 1916, withRpc: fn => Promise.resolve().then(() => fn(provider)), evmTxUrl: hash => '/tx/' + hash },
    Page: { render() {}, onWalletChanged() {} },
    Rest: { cosmosTxHash: async () => null },
    Bech32: { evmToBech32: () => 'epix1test' },
    ethers: {
      ...ethers,
      Contract: class {
        constructor() {
          return new Proxy({}, { get: (_, fn) => async (...args) => {
            if (fn === 'getRegistrationFee') { calls.quotes++; return c.liveFee; }
            calls.sends++;
            calls.sentArguments = args;
            return { hash: '0xreceipt', wait: async () => ({ status: 1 }) };
          } });
        }
      }
    },
    liveFee: 10000n * UNIT
  };
  c.window = c;
  vm.createContext(c);
  const load = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/wallet', file), 'utf8'), c, { filename: file });
  load('Wallet.js');
  c.Wallet.address = A;
  c.Wallet.raw = {};
  c.Wallet.chainOk = true;
  c.Wallet.signer = async () => { calls.signers++; return { getAddress: async () => c.Wallet.address }; };
  load('TxErrors.js');
  load('XidContract.js');
  load('RegistrationCost.js');
  load('TxState.js');
  return { c, calls, provider, cost: new c.RegistrationCost() };
}

test('registration cost uses exact integers and includes the RPC fee ceiling', async () => {
  const { c, cost, provider } = setup();
  const fee = 10000n * UNIT + 1n;
  provider.getBalance = async () => fee + 99999999999999n;
  await cost.setQuote('exact', 'epix', fee);
  assert.equal(cost.fee, fee);
  assert.equal(cost.networkFee, 100000000000000n);
  assert.equal(cost.total, fee + 100000000000000n);
  assert.equal(cost.balance, fee + 99999999999999n);
  assert.equal(c.Wallet.balanceRaw, cost.balance);
  assert.equal(cost.insufficient, true, 'a one-atomic-unit shortfall is not rounded away');
  assert.equal(cost.estimateStatus, 'insufficient');
});

test('zero balance is known insufficient; unavailable balance and fee are not fabricated zeros', async () => {
  const { cost, provider, calls } = setup();
  provider.getBalance = async () => 0n;
  await cost.setQuote('empty', 'epix', 10000n * UNIT);
  assert.equal(cost.balance, 0n);
  assert.equal(cost.insufficient, true);
  assert.equal(cost.networkFee, null);
  assert.equal(cost.total, null);
  assert.equal(calls.estimates, 0);
  provider.getBalance = async () => { throw new Error('unreachable'); };
  provider.estimateGas = async () => { throw new Error('cannot estimate'); };
  await cost.refresh();
  assert.equal(cost.balance, null);
  assert.ok(cost.balanceError);
  assert.equal(cost.insufficient, false);
  assert.equal(cost.total, null);
  assert.equal(cost.estimateStatus, 'unavailable');
  assert.equal(cost.loading, false);
});

test('changing the name or clearing the quote discards late fee estimates', async () => {
  const { c, cost } = setup();
  const old = deferred();
  c.XidContract.estimateNetworkFee = () => old.promise;
  const first = cost.setQuote('first', 'epix', UNIT);
  await tick();
  c.XidContract.estimateNetworkFee = async () => 7n;
  await cost.setQuote('second', 'epix', 2n * UNIT);
  old.resolve(999n);
  await first;
  assert.equal(cost.name, 'second');
  assert.equal(cost.networkFee, 7n);
  const late = deferred();
  c.XidContract.estimateNetworkFee = () => late.promise;
  const refreshing = cost.refresh();
  await tick();
  cost.clear();
  late.resolve(8n);
  await refreshing;
  assert.equal(cost.fee, null);
  assert.equal(cost.total, null);
  assert.equal(cost.estimateStatus, 'no_quote');
});

test('wallet account changes discard in-flight balances and cost estimates', async () => {
  const { c, cost, provider } = setup();
  const old = deferred();
  provider.getBalance = () => old.promise;
  const first = cost.setQuote('alice', 'epix', UNIT);
  await tick();
  c.Wallet.address = B;
  ++c.Wallet.revision;
  c.Wallet.clearBalance();
  provider.getBalance = async () => 3n * UNIT;
  await cost.onWalletChanged();
  old.resolve(0n);
  await first;
  assert.equal(cost.balance, 3n * UNIT);
  assert.equal(c.Wallet.balanceRaw, 3n * UNIT);
  assert.equal(cost.insufficient, false);
  c.Wallet.disconnect();
  assert.equal(cost.balance, null);
  await cost.onWalletChanged();
  assert.equal(cost.estimateStatus, 'wallet_required');
});

test('wrong-network quotes do not estimate and recover after switching', async () => {
  const { c, cost, calls } = setup();
  c.Wallet.chainOk = false;
  await cost.setQuote('alice', 'epix', UNIT);
  assert.equal(cost.estimateStatus, 'wrong_network');
  assert.equal(cost.total, null);
  assert.equal(calls.estimates, 0);
  c.Wallet.chainOk = true;
  await cost.onWalletChanged();
  assert.equal(cost.estimateStatus, 'ready');
  assert.ok(cost.total > UNIT);
});

test('balance refresh failure clears an old balance and concurrent reads share a request', async () => {
  const { c, provider } = setup();
  const first = deferred();
  provider.getBalance = () => first.promise;
  const a = c.Wallet.loadBalance(), b = c.Wallet.loadBalance();
  assert.equal(a, b);
  first.resolve(123456789012345678901n);
  assert.equal(await a, 123456789012345678901n);
  provider.getBalance = async () => { throw new Error('offline'); };
  assert.equal(await c.Wallet.loadBalance(), null);
  assert.equal(c.Wallet.balance, null);
  assert.equal(c.Wallet.balanceRaw, null);
  assert.equal(c.Wallet.balanceLoading, false);
  assert.match(c.Wallet.balanceError, /Could not check/);
});

test('without a name quote the card can still show the current exact wallet balance', async () => {
  const { c, cost } = setup();
  const reading = c.Wallet.loadBalance();
  assert.equal(cost.balanceLoading, true);
  await reading;
  assert.equal(cost.balance, 20000n * UNIT);
  assert.equal(cost.balanceLoading, false);
  assert.equal(cost.total, null);
  assert.equal(cost.insufficient, false);
});

test('a late chain response from an old wallet cannot replace the new connection state', async () => {
  const { c } = setup();
  c.ethers.BrowserProvider = class {};
  const oldChain = deferred();
  const old = c.Wallet.onConnected({ address: A, provider: { request: () => oldChain.promise } });
  await c.Wallet.onConnected({ address: B, provider: { request: async () => '0x77c' } });
  oldChain.resolve('0x1');
  await old;
  await tick();
  assert.equal(c.Wallet.address, B);
  assert.equal(c.Wallet.chainOk, true);
  assert.equal(c.Wallet.balanceRaw, 20000n * UNIT);
});

test('fee estimation uses gasPrice when no fee ceiling is available and rejects missing values', async () => {
  const { c, provider } = setup();
  provider.getFeeData = async () => ({ maxFeePerGas: null, gasPrice: 3n });
  assert.equal(await c.XidContract.estimateNetworkFee('register', ['alice', 'epix'], A), 300000n);
  provider.getFeeData = async () => ({ maxFeePerGas: null, gasPrice: null });
  await assert.rejects(c.XidContract.estimateNetworkFee('register', ['alice', 'epix'], A), /unavailable/);
});

test('a changed quoted fee stops registration before any wallet request', async () => {
  const { c, calls } = setup();
  c.liveFee += 1n;
  await assert.rejects(c.XidContract.write('register', ['alice', 'epix'], null, { registrationFee: 10000n * UNIT }), error => {
    assert.equal(error.code, 'REGISTRATION_FEE_CHANGED');
    assert.equal(error.currentFee, c.liveFee);
    return true;
  });
  assert.equal(calls.signers, 0);
  assert.equal(calls.sends, 0);
});

test('exact balance preflight includes the estimated network fee', async () => {
  const { c, calls, provider } = setup();
  provider.getBalance = async () => c.liveFee;
  await assert.rejects(c.XidContract.write('register', ['alice', 'epix'], null, { registrationFee: c.liveFee }), error => {
    assert.equal(error.code, 'REGISTRATION_BALANCE_LOW');
    assert.ok(error.required > c.liveFee);
    assert.match(c.TxErrors.friendly(error), /including the network fee/);
    return true;
  });
  assert.equal(calls.signers, 0);
  assert.equal(calls.sends, 0);
});

test('raw EVM funds do not bypass the spendable-balance simulation', async () => {
  const { c, calls, provider } = setup();
  const reason = 'failed to charge registration fee: spendable balance 0aepix is smaller than 10000000000000000000000aepix: insufficient funds: insufficient registration fee';
  provider.call = async () => { throw { reason }; };
  await assert.rejects(c.XidContract.write('register', ['alice', 'epix'], null, { registrationFee: c.liveFee }), error => {
    assert.equal(c.TxErrors.extract(error), reason);
    assert.match(c.TxErrors.friendly(error), /spendable balance on Epix is 0 EPIX/);
    assert.match(c.TxErrors.friendly(error), /10,000 EPIX/);
    assert.doesNotMatch(c.TxErrors.friendly(error), /aepix/);
    return true;
  });
  assert.equal(calls.signers, 0);
  assert.equal(calls.sends, 0);
});

test('fee changes while obtaining the signer stop the final send', async () => {
  const { c, calls } = setup();
  c.Wallet.signer = async () => { calls.signers++; c.liveFee += UNIT; return {}; };
  await assert.rejects(c.XidContract.write('register', ['alice', 'epix'], null, { registrationFee: c.liveFee }), error => error.code === 'REGISTRATION_FEE_CHANGED');
  assert.equal(calls.quotes, 2);
  assert.equal(calls.sends, 0);
});

test('an account change during simulation cannot send from a different wallet', async () => {
  const { c, provider, calls } = setup();
  provider.call = async () => { c.Wallet.address = B; return '0x'; };
  await assert.rejects(c.XidContract.write('register', ['alice', 'epix'], null, { registrationFee: c.liveFee }), /wallet changed/);
  assert.equal(calls.signers, 0);
  assert.equal(calls.sends, 0);
});

test('ordinary linking retains its simulation, wallet and receipt lifecycle without registration charges', async () => {
  const { c, calls } = setup();
  const statuses = [];
  const receipt = await c.XidContract.write('linkIdentity', ['alice', 'epix', 'epix1identity', 'epixnet'], status => statuses.push(status));
  assert.equal(receipt.status, 1);
  assert.deepEqual(statuses, ['simulating', 'pending', 'confirming', 'success']);
  assert.equal(calls.quotes, 0);
  assert.equal(calls.estimates, 0);
  assert.equal(calls.sends, 1);
  const override = calls.sentArguments.at(-1);
  assert.equal(override.from, A);
  assert.equal(override.chainId, 1916);
});

test('TxState forwards registration consent and exposes friendly and original error text', async () => {
  const { c } = setup();
  const tx = new c.TxState();
  const options = { registrationFee: 10000n * UNIT };
  c.XidContract.write = async (fn, args, notify, passed) => {
    assert.equal(passed, options);
    throw { info: { error: { code: 4001, message: 'wallet rejected request' } }, message: 'request failed' };
  };
  await tx.run('register', ['alice', 'epix'], () => assert.fail('no success callback'), options);
  assert.equal(tx.status, 'error');
  assert.match(tx.friendlyErrorText, /cancelled the wallet request/);
  assert.equal(tx.errorText, 'request failed', 'other management views retain their original error text');
  assert.equal(tx.errorDetails, 'request failed');
});


test('fractional EPIX errors use the locale decimal separator', () => {
  const { c } = setup();
  c.Intl = { NumberFormat: class { constructor() { return new Intl.NumberFormat('de-DE'); } } };
  const error = { reason: 'failed to charge registration fee: spendable balance 1500000000000000000aepix is smaller than 2500000000000000000aepix: insufficient registration fee' };
  assert.match(c.TxErrors.friendly(error), /1,5 EPIX/);
  assert.match(c.TxErrors.friendly(error), /2,5 EPIX/);
});
