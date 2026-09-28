const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function setup() {
  let nextTimer = 0, now = 0;
  const timers = new Map(), writes = [];
  const context = {
    console, Map, Promise, URL,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Page: { render() {}, isEmbedded: true },
    Wallet: { address: '0x1111111111111111111111111111111111111111', isConnected() { return !!this.address; }, renderButton() { return { tag: 'wallet' }; } },
    Chain: { DEFAULT_TLD: 'epix' },
    XidContract: { ZERO: '0x0000000000000000000000000000000000000000', read: async () => ['', ''], peersFrom: rows => rows },
    Rest: { namesAll: async () => ({ names: [{ name: 'alice', tld: 'epix' }], total: 1 }) },
    Format: { ether: String },
    Icons: new Proxy({}, { get: () => () => ({ tag: 'icon' }) }),
    h(tag, props, children) { return { tag, ...(props && typeof props === 'object' && !Array.isArray(props) ? { props, children } : { children: props }) }; },
    location: { href: '' }
  };
  context.window = context;
  context.top = context;
  context.TxState = class {
    constructor() { this.status = 'idle'; this.errorText = ''; }
    get isBusy() { return this.status === 'pending'; }
    get isSuccess() { return this.status === 'success'; }
    get isPending() { return this.status === 'pending'; }
    get isConfirming() { return false; }
    run(fn, args, done) { writes.push({ fn, args, done, tx: this }); this.status = 'pending'; }
  };
  vm.createContext(context);
  for (const file of ['js/utils/Text.js', 'js/utils/Bech32.js', 'js/pages/AddPeerPage.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const peer = context.Bech32.evmToBech32('0x2222222222222222222222222222222222222222');
  const page = new context.AddPeerPage();
  page.enter(peer, '/epix1talk58lw26c0cyrtuu8axptne2p6zf33s7xxwu/?Topic:123');
  context.Page.cmd = async () => null;
  const advance = async duration => {
    const end = now + duration;
    for (;;) {
      await flush();
      const entry = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      now = entry[1].at;
      timers.delete(entry[0]);
      entry[1].fn();
    }
    now = end;
    await flush();
  };
  const choose = () => { page.selectedName = 'alice'; page.selectedTld = 'epix'; page.selectionConfirmed = true; };
  const localRow = () => ({ xid: 'alice.epix', auth_address: peer, cert_user_id: 'alice@xid.epix' });
  return { context, page, peer, timers, writes, advance, choose, localRow };
}

function textOf(value) { return JSON.stringify(value, (key, entry) => typeof entry === 'function' ? undefined : entry); }

test('primary is a visible default; Continue and Change keep alternatives accessible', async () => {
  const { context, page } = setup(); await flush();
  context.Rest.namesAll = async () => ({ names: [{ name: 'alice', tld: 'epix' }, { name: 'bob', tld: 'epix' }], total: 2 });
  context.XidContract.read = async () => ['alice', 'epix'];
  page.selectedName = '';
  page.handleRetryNames(); await flush();
  assert.equal(page.selectedName, 'alice');
  assert.equal(page.currentStep(), 1);
  assert.match(textOf(page.render()), /bob.epix/);
  page.handleContinue(); assert.equal(page.currentStep(), 2);
  page.handleChange(); assert.equal(page.currentStep(), 1);
  assert.match(textOf(page.render()), /Register a new name/);
});

test('account changes ignore late reads and discard the previous primary', async () => {
  const { context, page } = setup(); await flush();
  const oldNames = deferred(), oldPrimary = deferred(), newNames = deferred(), newPrimary = deferred();
  context.Rest.namesAll = () => oldNames.promise;
  context.XidContract.read = () => oldPrimary.promise;
  page.handleRetryNames();
  context.Rest.namesAll = () => newNames.promise;
  context.XidContract.read = () => newPrimary.promise;
  context.Wallet.address = '0x3333333333333333333333333333333333333333';
  page.onWalletChanged();
  newNames.resolve({ names: [{ name: 'bob', tld: 'epix' }], total: 1 });
  newPrimary.resolve(['bob', 'epix']); await flush();
  oldNames.resolve({ names: [{ name: 'alice', tld: 'epix' }], total: 1 });
  oldPrimary.resolve(['alice', 'epix']); await flush();
  assert.equal(page.selectedName, 'bob'); assert.equal(page.primaryName, 'bob');
  assert.equal(page.names[0].name, 'bob');
});

test('unavailable names API is an error, not an empty wallet', async () => {
  const { context, page } = setup(); await flush();
  context.Rest.namesAll = async () => { throw Error('offline'); };
  await page.loadNames();
  assert.ok(page.namesError);
  assert.match(textOf(page.renderSelect()), /Retry names/);
  assert.doesNotMatch(textOf(page.renderSelect()), /does not own any names/);
});

test('registration uses the normalized currently priced name and blocks stale availability', async () => {
  const { context, page, writes } = setup(); await flush();
  context.XidContract.read = async fn => fn === 'resolve' ? context.XidContract.ZERO : 1n;
  page.handleNewNameInput({ target: { value: ' Alice.EPIX ' } }); await flush();
  assert.equal(page.canRegister(), true);
  page.handleRegister();
  assert.equal(writes[0].args[0], 'alice');
  page.registerTx = new context.TxState();
  context.XidContract.read = () => new Promise(() => {});
  page.handleNewNameInput({ target: { value: 'bob' } });
  assert.equal(page.canRegister(), false);
  page.handleRegister(); assert.equal(writes.length, 1);
});

test('lookup failures are retryable and are not shown as Taken', async () => {
  const { context, page } = setup(); await flush();
  context.XidContract.read = async () => { throw Error('offline'); };
  page.handleNewNameInput({ target: { value: 'alice' } }); await flush();
  assert.ok(page.lookupError); assert.equal(page.isAvailable, false);
  assert.match(textOf(page.renderRegisterForm()), /Retry check/);
  assert.doesNotMatch(textOf(page.renderRegisterForm()), /already registered/);
});

test('register success preserves origin and identity then advances to linking', async () => {
  const { context, page, writes, peer } = setup(); await flush();
  context.XidContract.read = async fn => fn === 'resolve' ? context.XidContract.ZERO : 1n;
  page.handleNewNameInput({ target: { value: 'newname' } }); await flush();
  page.handleRegister(); writes[0].tx.status = 'success'; writes[0].done(); await flush();
  assert.equal(page.selectedName, 'newname'); assert.equal(page.currentStep(), 2);
  assert.equal(page.peerAddress, peer); assert.match(page.returnTo, /Topic:123$/);
  assert.equal(context.location.href, '');
});

test('Change name can resume a mined registration before REST catches up', async () => {
  const { context, page, writes } = setup(); await flush();
  context.Rest.namesAll = async () => ({ names: [], total: 0 });
  context.XidContract.read = async fn => fn === 'resolve' ? context.XidContract.ZERO : 1n;
  page.handleNewNameInput({ target: { value: 'newname' } }); await flush();
  page.handleRegister();
  context.XidContract.read = async fn => fn === 'resolve' ? context.Wallet.address : ['', ''];
  writes[0].tx.status = 'success'; writes[0].done(); await flush();
  page.handleChange();
  assert.equal(page.names.some(entry => entry.name === 'newname'), true);
  page.handleContinue();
  assert.equal(page.currentStep(), 2);
  assert.equal(page.selectedName, 'newname');
});

test('receipt preservation is retired after REST catches up and never masks another owner', async () => {
  const { context, page } = setup(); await flush();
  const entry = { name: 'newname', tld: 'epix' };
  page.receiptNames = [entry];
  context.Rest.namesAll = async () => ({ names: [entry], total: 1 });
  await page.loadNames();
  assert.equal(page.receiptNames.length, 0);
  context.Rest.namesAll = async () => ({ names: [], total: 0 });
  await page.loadNames();
  assert.equal(page.names.length, 0);
  page.receiptNames = [entry];
  context.XidContract.read = async () => '0x9999999999999999999999999999999999999999';
  await page.loadNames();
  assert.equal(page.names.length, 0);
  assert.equal(page.receiptNames.length, 0);
});

test('receipt-confirmed entries are cleared when the account changes or the wizard closes', async () => {
  const { context, page } = setup(); await flush();
  page.receiptNames = [{ name: 'alice', tld: 'epix' }];
  context.Wallet.address = '0x3333333333333333333333333333333333333333';
  page.onWalletChanged();
  assert.equal(page.receiptNames.length, 0);
  page.receiptNames = [{ name: 'bob', tld: 'epix' }];
  page.leave();
  assert.equal(page.receiptNames.length, 0);
});

test('a registration callback from the previous account cannot select its name', async () => {
  const { context, page, writes } = setup(); await flush();
  context.XidContract.read = async fn => fn === 'resolve' ? context.XidContract.ZERO : 1n;
  page.handleNewNameInput({ target: { value: 'oldaccount' } }); await flush();
  page.handleRegister();
  context.Wallet.address = '0x3333333333333333333333333333333333333333';
  context.Rest.namesAll = async () => ({ names: [{ name: 'bob', tld: 'epix' }], total: 1 });
  context.XidContract.read = async () => ['bob', 'epix'];
  page.onWalletChanged(); await flush();
  writes[0].done(); await flush();
  assert.equal(page.selectedName, 'bob');
  assert.equal(page.selectionConfirmed, false);
});

test('a mined existing link resumes confirmation without a second transaction', async () => {
  const { context, page, peer, choose, writes } = setup(); await flush(); choose();
  context.XidContract.read = async () => [{ address: peer, active: true }];
  await page.handleLink(); await flush();
  assert.equal(page.chainLinked, true); assert.equal(writes.length, 0);
});

test('confirmation timeout never declares readiness or redirects, and retry sends no transaction', async () => {
  const { context, page, choose, advance, writes } = setup(); await flush(); choose(); page.chainLinked = true;
  context.Page.cmd = async method => method === 'identityList' ? { identities: [] } : null;
  page.startPolling(); await advance(60000);
  assert.equal(page.linkStatus, 'error'); assert.equal(page.nodeRecorded, false);
  assert.equal(context.location.href, '');
  assert.match(textOf(page.renderLink()), /Retry confirmation/);
  page.handleRetryConfirmation(); assert.equal(page.linkStatus, 'polling'); assert.equal(writes.length, 0);
});

test('an unanswered wrapper request remains bounded by the confirmation deadline', async () => {
  const { context, page, choose, advance, timers } = setup(); await flush(); choose(); page.chainLinked = true;
  context.Page.cmd = () => new Promise(() => {});
  page.startPolling(); await advance(60000);
  assert.equal(page.linkStatus, 'error'); assert.equal(context.location.href, '');
  assert.equal(timers.size, 0);
});

test('wrong name, wrong TLD and revoked results cannot confirm a link', async () => {
  for (const result of [{ name: 'wrong', tld: 'epix', active: true }, { name: 'alice', tld: 'wrong', active: true }, { name: 'alice', tld: 'epix', active: false }]) {
    const { context, page, choose, advance, localRow } = setup(); await flush(); choose(); page.chainLinked = true;
    let reads = 0;
    context.Page.cmd = async method => method === 'identityList' ? { identities: reads++ ? [localRow()] : [] } : method === 'xidResolve' ? result : 'ok';
    page.startPolling(); await advance(60000);
    assert.equal(page.linkStatus, 'error'); assert.equal(context.location.href, '');
  }
});

test('a fallback name result with no exact active peer cannot confirm', async () => {
  const { context, page, choose, advance, localRow } = setup(); await flush(); choose(); page.chainLinked = true;
  let reads = 0;
  context.Page.cmd = async method => method === 'identityList' ? { identities: reads++ ? [localRow()] : [] } : method === 'xidResolve' ? { name: 'alice', tld: 'epix', active: true } : 'ok';
  context.XidContract.read = async () => [{ address: 'another-address', active: true }];
  page.startPolling(); await advance(60000);
  assert.equal(page.linkStatus, 'error'); assert.equal(context.location.href, '');
});

test('new exact chain link and local certificate automatically return to the preserved origin', async () => {
  const { context, page, peer, choose, advance, localRow } = setup(); await flush(); choose(); page.chainLinked = true;
  let reads = 0;
  context.Page.cmd = async method => method === 'identityList' ? { identities: reads++ ? [localRow()] : [] } : method === 'xidResolve' ? { name: 'alice', tld: 'epix', active: true } : 'ok';
  context.XidContract.read = async () => [{ address: peer, active: true }];
  page.startPolling(); await flush();
  assert.equal(page.linkStatus, 'ready'); assert.equal(page.nodeRecorded, true);
  assert.equal(context.location.href, '');
  await advance(1500); assert.equal(context.location.href, page.returnTo);
});

test('an already recorded certificate provides explicit return rather than assuming origin selection', async () => {
  const { context, page, peer, choose, advance, localRow } = setup(); await flush(); choose(); page.chainLinked = true;
  context.Page.cmd = async method => method === 'identityList' ? { identities: [localRow()] } : method === 'xidResolve' ? { name: 'alice', tld: 'epix', active: true } : 'ok';
  context.XidContract.read = async () => [{ address: peer, active: true }];
  page.startPolling(); await advance(60000);
  assert.equal(page.linkStatus, 'ready'); assert.equal(context.location.href, '');
  page.handleReturn(); assert.equal(context.location.href, page.returnTo);
});

test('leaving cancels pending checks and ignores late responses', async () => {
  const { context, page, choose, advance, timers } = setup(); await flush(); choose(); page.chainLinked = true;
  const pending = deferred(); context.Page.cmd = () => pending.promise;
  page.startPolling(); await flush(); page.leave();
  pending.resolve({ identities: [] }); await advance(60000);
  assert.equal(page.active, false); assert.equal(context.location.href, '');
  assert.equal(timers.size, 0); assert.equal(page.pendingCalls.size, 0);
});

test('leaving after readiness cancels the scheduled automatic return', async () => {
  const { context, page, peer, choose, advance, localRow, timers } = setup(); await flush(); choose(); page.chainLinked = true;
  let reads = 0;
  context.Page.cmd = async method => method === 'identityList' ? { identities: reads++ ? [localRow()] : [] } : method === 'xidResolve' ? { name: 'alice', tld: 'epix', active: true } : 'ok';
  context.XidContract.read = async () => [{ address: peer, active: true }];
  page.startPolling(); await flush();
  assert.equal(page.linkStatus, 'ready');
  page.leave(); await advance(1500);
  assert.equal(context.location.href, ''); assert.equal(timers.size, 0);
});

test('unsafe return targets and invalid identity addresses cannot submit a link', async () => {
  const { page, context, writes, choose } = setup(); await flush();
  page.enter('not-an-address', '//external.example/path'); choose();
  await page.handleLink(); page.handleReturn();
  assert.equal(page.returnTo, ''); assert.equal(writes.length, 0); assert.equal(context.location.href, '');
});

test('return targets cannot become external URLs after browser normalization', async () => {
  const { context, page, peer } = setup(); await flush();
  const targets = [
    '/\n/evil.example', '/\t\\evil.example', '/\r/evil.example',
    '//evil.example', '/\\evil.example', 'https://evil.example', '/safe\u0000/path'
  ];
  for (const target of targets) {
    assert.equal(context.Text.safeReturnTo(target), '', JSON.stringify(target));
    page.enter(peer, target);
    page.handleReturn();
    assert.equal(context.location.href, '');
  }
  const encoded = new URLSearchParams('returnTo=%2F%0A%2Fevil.example').get('returnTo');
  assert.equal(context.Text.safeReturnTo(encoded), '');
});

test('valid relative return targets keep the full xite, query, and fragment', async () => {
  const { context, page, peer } = setup(); await flush();
  for (const target of ['/Config', '/epix1talk/?Topic:123&sort=new#comment-7', '/epix1post/?Profile/alice.epix', '/']) {
    assert.equal(context.Text.safeReturnTo(target), target);
    page.enter(peer, target);
    page.handleReturn();
    assert.equal(context.location.href, target);
  }
});
