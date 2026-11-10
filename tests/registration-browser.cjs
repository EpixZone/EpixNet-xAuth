/*
 * Run against an EpixNet UiServer serving this checkout:
 *   EPIX_PLAYWRIGHT_MODULE=/path/to/playwright node tests/registration-browser.cjs --run-live
 * Optional: EPIX_XAUTH_URL, EPIX_XAUTH_BROWSER_OUTPUT, EPIX_XAUTH_BROWSER_GROUPS.
 *
 * Live-read cases use the real wrapper, xite assets, and chain RPC. Expected
 * prices are queried independently, never copied from a fixed price table.
 * Controlled cases retain those assets but replace wallet balances, owned
 * names, transaction results, and node confirmation in the isolated page.
 * They test UI behavior, not actual signing, broadcast, or certificate writes.
 * The injected provider rejects every signing and transaction request.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

if (!process.argv.includes('--run-live')) {
  console.log('Use --run-live with an EpixNet server serving the current checkout. No wallet or transaction is used.');
  process.exit(0);
}

const { chromium } = require(process.env.EPIX_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.EPIX_XAUTH_URL || 'http://127.0.0.1:42222/epix1xauthduuyn63k6kj54jzgp4l8nnjlhrsyaku8c/';
const output = process.env.EPIX_XAUTH_BROWSER_OUTPUT || path.resolve(__dirname, '../test-results/registration-browser');
const only = new Set((process.env.EPIX_XAUTH_BROWSER_GROUPS || '').split(',').filter(Boolean));
const report = { base, startedAt: new Date().toISOString(), scope: { live: 'Actual server assets and read-only chain quotes', controlled: 'Isolated wallet, transaction, ownership and node-confirmation simulation; no real writes' }, groups: [] };
const contexts = new Set();
fs.mkdirSync(output, { recursive: true });
let browser;

function installTestWallet() {
  const listeners = new Map();
  const state = { address: '0x1111111111111111111111111111111111111111', chainId: '0x77c', calls: [], forbidden: [] };
  const emit = (name, value) => (listeners.get(name) || []).forEach(fn => fn(value));
  window.__testWallet = {
    state,
    account(address) { state.address = address; emit('accountsChanged', address ? [address] : []); },
    chain(chainId) { state.chainId = chainId; emit('chainChanged', chainId); }
  };
  window.ethereum = {
    isMetaMask: true,
    on(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]); },
    removeListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== fn)); },
    async request({ method, params }) {
      state.calls.push(method);
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return state.address ? [state.address] : [];
      if (method === 'eth_chainId') return state.chainId;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
        state.chainId = params[0].chainId;
        emit('chainChanged', state.chainId);
        return null;
      }
      state.forbidden.push(method);
      throw new Error('Test wallet refuses signing, transactions, and unsupported methods: ' + method);
    }
  };
}

async function open(width, flow = 'register', fakeWallet = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'en-US' });
  contexts.add(context);
  if (fakeWallet) await context.addInitScript(installTestWallet);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // A valid, public test address. It is never linked by the real node.
  const peer = 'epix1xauthduuyn63k6kj54jzgp4l8nnjlhrsyaku8c';
  const query = flow === 'wizard' ? '?linkIdentity=' + peer + '&returnTo=' + encodeURIComponent('/Config?tab=identity') : '';
  await page.goto(base + query);
  const element = await page.locator('#inner-iframe').elementHandle();
  const frame = element ? await element.contentFrame() : page.mainFrame();
  await frame.waitForFunction(() => window.Page && Page.server_info && document.querySelector('.RegisterPage, .AddPeerPage'));
  assert.equal(await frame.evaluate(() => typeof RegistrationCard), 'function', 'Server must serve the implemented card, not old assets');
  if (!report.sourceHashes) {
    report.sourceHashes = {};
    for (const file of ['js/RegistrationCard.js', 'js/pages/RegisterPage.js', 'js/pages/AddPeerPage.js', 'js/wallet/RegistrationCost.js', 'js/wallet/Wallet.js', 'js/wallet/XidContract.js', 'js/wallet/TxState.js', 'js/wallet/TxErrors.js', 'css/all.css']) {
      const served = await frame.evaluate(async file => {
        const response = await fetch(file, { cache: 'no-store' });
        if (!response.ok) throw new Error('Asset unavailable: ' + file);
        return response.text();
      }, file);
      const hash = value => createHash('sha256').update(value).digest('hex');
      const expected = hash(fs.readFileSync(path.resolve(__dirname, '..', file)));
      assert.equal(hash(served), expected, 'Live asset must match the checkout: ' + file);
      report.sourceHashes[file] = expected;
    }
  }
  return { context, page, frame, errors, width, flow };
}

async function close(testPage) {
  if (!testPage) return;
  const forbidden = await testPage.frame.evaluate(() => window.__testWallet?.state.forbidden || []).catch(() => []);
  assert.deepEqual(forbidden, [], 'No signing or transaction request may reach even the test wallet');
  assert.deepEqual(testPage.errors, [], 'No browser exceptions');
  await testPage.context.close();
  contexts.delete(testPage.context);
}

async function connect(testPage) {
  const { frame } = testPage;
  const host = frame.locator(testPage.flow === 'wizard' ? '.AddPeerPage' : '.RegisterPage');
  await host.getByRole('button', { name: /^Connect wallet$/i }).first().click();
  await frame.locator('#epixkit-list button').first().click();
  await frame.waitForFunction(() => Wallet.isConnected() && !Wallet.connecting && Wallet.chainOk);
}

async function layout(testPage, label) {
  const { frame, page, width } = testPage;
  const geometry = await frame.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(geometry.page <= geometry.viewport + 1 && geometry.body <= geometry.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(geometry)}`);
  await page.screenshot({ path: path.join(output, `${label}-${width}.png`), fullPage: true, animations: 'disabled' });
  return geometry;
}

async function quote(testPage, input) {
  const { frame, flow } = testPage;
  const selector = flow === 'wizard' ? '#wizard-name' : '#register-name';
  await frame.locator(selector).fill(input);
  await frame.waitForFunction(({ flow, input }) => {
    const p = flow === 'wizard' ? Page.pages.add_peer : Page.pages.register;
    const parsed = Text.nameInput(input);
    return !p.resolving && p.fee !== null && (flow === 'wizard' ? p.lookupName : p.quotedName) === parsed.name;
  }, { flow, input }, { timeout: 30000 });
  const actual = await frame.evaluate(async ({ flow, input }) => {
    const parsed = Text.nameInput(input), p = flow === 'wizard' ? Page.pages.add_peer : Page.pages.register;
    const independentFee = await XidContract.read('getRegistrationFee', [parsed.name, parsed.tld]);
    return { input, name: parsed.name, quoted: (flow === 'wizard' ? p.lookupName : p.quotedName), fee: String(p.fee), independentFee: String(independentFee), display: Format.epix(independentFee) + ' EPIX', connected: Wallet.isConnected() };
  }, { flow, input });
  assert.equal(actual.quoted, actual.name);
  assert.equal(actual.fee, actual.independentFee, 'Displayed model quote matches a separate live RPC read');
  assert.equal(await frame.locator('.registration-fee').innerText(), actual.display);
  assert.equal(await frame.locator('.registration-fee').getAttribute('data-name'), actual.name);
  return actual;
}

async function invalidAndStale(testPage) {
  const { frame, flow } = testPage;
  const selector = flow === 'wizard' ? '#wizard-name' : '#register-name';
  await frame.locator(selector).fill('not valid!');
  await frame.waitForFunction(flow => {
    const p = flow === 'wizard' ? Page.pages.add_peer : Page.pages.register;
    return p.fee === null && !p.resolving && !p.canRegister();
  }, flow);
  await frame.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-invalid') === 'true', selector);
  assert.equal(await frame.locator(selector).getAttribute('aria-invalid'), 'true');
  assert.match(await frame.locator('.registration-fee').innerText(), /valid name/);
  // Delay real responses for the older name while allowing the newer live
  // requests through. This tests response ordering without inventing prices.
  await frame.evaluate(() => {
    const realRead = XidContract.read.bind(XidContract);
    window.__heldQuote = { release: null, count: 0, restore: () => { XidContract.read = realRead; } };
    const gate = new Promise(resolve => { __heldQuote.release = resolve; });
    XidContract.read = async function (fn, args) {
      const promise = realRead(fn, args);
      if (args?.[0] === 'qa-old-read' && (fn === 'resolve' || fn === 'getRegistrationFee')) { __heldQuote.count++; await gate; }
      return promise;
    };
  });
  await frame.locator(selector).fill('qa-old-read');
  await frame.waitForFunction(() => __heldQuote.count === 2);
  await frame.locator(selector).fill('qa-new-read');
  const staleBlocked = await frame.evaluate(flow => {
    const p = flow === 'wizard' ? Page.pages.add_peer : Page.pages.register;
    return p.fee === null && !p.canRegister();
  }, flow);
  assert.equal(staleBlocked, true, 'A previous name cannot remain actionable while typing');
  await quote(testPage, 'qa-new-read');
  await frame.evaluate(() => { __heldQuote.release(); __heldQuote.restore(); });
  await frame.waitForTimeout(250);
  assert.equal(await frame.locator('.registration-fee').getAttribute('data-name'), 'qa-new-read');
  return quote(testPage, '  Qa-Full-Name.EPIX  ');
}

async function installControlledState(testPage, names = []) {
  await testPage.frame.evaluate(names => {
    const realRpc = Chain.withRpc.bind(Chain), realRead = XidContract.read.bind(XidContract), realCmd = Page.cmd.bind(Page);
    const state = window.__registrationFixture = {
      balance: 0n, failBalance: false, failEstimate: false, names, primary: names[0]?.name || '',
      writes: [], registered: new Set(), linked: false, nodeReady: false, commands: [], pending: null, writeError: null
    };
    Chain.withRpc = fn => realRpc(provider => fn(new Proxy(provider, {
      get(target, key) {
        if (key === 'getBalance') return async () => { if (state.failBalance) throw new Error('Controlled balance unavailable'); return state.balance; };
        if (key === 'estimateGas') return async () => { if (state.failEstimate) throw new Error('Controlled estimate unavailable'); return 21000n; };
        if (key === 'getFeeData') return async () => ({ gasPrice: 1000000000n, maxFeePerGas: 2000000000n });
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })));
    Rest.namesAll = async () => ({ names: state.names.slice(), total: state.names.length });
    Rest.cosmosTxHash = async () => null;
    XidContract.read = (fn, args) => {
      if (fn === 'getPrimaryName') return Promise.resolve([state.primary, state.primary ? 'epix' : '']);
      if (fn === 'getLinkedIdentities') return Promise.resolve(state.linked ? [[Page.pages.add_peer.peerAddress], ['test'], [1n], [true], [0n], [0n]] : [[], [], [], [], [], []]);
      if (fn === 'resolve' && state.registered.has(args[0])) return Promise.resolve(Wallet.address);
      return realRead(fn, args);
    };
    XidContract.write = async (fn, args, onStatus) => {
      state.writes.push({ fn, args: [...args] });
      if (state.writeError) throw state.writeError;
      onStatus('pending');
      await new Promise(resolve => { state.pending = resolve; });
      const hash = '0x' + '7'.repeat(64);
      onStatus('confirming', hash);
      await new Promise(resolve => { state.pending = resolve; });
      if (fn === 'register') {
        state.registered.add(args[0]);
        state.names.push({ name: args[0], tld: args[1] });
      }
      if (fn === 'linkIdentity') state.linked = true;
      onStatus('success', hash);
      return { status: 1, hash };
    };
    // Confirmation commands remain inside this test page. In particular,
    // xidInvalidateCache never reaches the real node during a simulated link.
    Page.cmd = (method, params, callback) => {
      if (!['identityList', 'xidInvalidateCache', 'xidResolve'].includes(method)) return realCmd(method, params, callback);
      state.commands.push(method);
      const p = Page.pages.add_peer;
      const result = method === 'identityList' ? { identities: state.nodeReady ? [{ xid: p.selectedName + '.' + p.selectedTld, auth_address: p.peerAddress, cert_user_id: p.selectedName + '@xid.epix' }] : [] }
        : method === 'xidResolve' ? (state.nodeReady ? { name: p.selectedName, tld: p.selectedTld, active: true } : null) : 'ok';
      if (callback) callback(result);
      return Promise.resolve(result);
    };
  }, names);
}

async function refreshControlled(testPage, overrides) {
  await testPage.frame.evaluate(async ({ flow, overrides }) => {
    for (const [key, value] of Object.entries(overrides)) __registrationFixture[key] = key === 'balance' ? BigInt(value) : value;
    const p = flow === 'wizard' ? Page.pages.add_peer : Page.pages.register;
    await p.cost.refresh();
    Page.render();
  }, { flow: testPage.flow, overrides });
  await testPage.frame.waitForFunction(flow => {
    const c = (flow === 'wizard' ? Page.pages.add_peer : Page.pages.register).cost;
    return !c.loading && !c.balanceLoading;
  }, testPage.flow);
  await testPage.frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function runGroup(name, scope, action) {
  if (only.size && !only.has(name)) return;
  const entry = { name, scope, startedAt: new Date().toISOString() };
  report.groups.push(entry);
  console.log('START ' + name + ' [' + scope + ']');
  try {
    entry.result = await action();
    entry.status = 'passed';
    console.log('PASS ' + name);
  } catch (error) {
    entry.status = 'failed'; entry.error = error.stack;
    throw error;
  } finally { entry.finishedAt = new Date().toISOString(); }
}

async function liveReads() {
  const results = [];
  for (const width of [1280, 390]) for (const flow of ['register', 'wizard']) {
    const t = await open(width, flow, flow === 'wizard');
    try {
      if (flow === 'wizard') { await connect(t); await t.frame.locator('#wizard-name').waitFor(); }
      for (const name of ['q', 'qz', 'qzx', 'qzxy', 'qa-registration-read']) results.push({ width, flow, ...await quote(t, name) });
      results.push({ width, flow, normalized: await invalidAndStale(t) });
      await layout(t, 'live-' + flow);
    } finally { await close(t); }
  }
  return results;
}

async function navigation() {
  const t = await open(390);
  try {
    const routes = [['Search', 'SearchPage'], ['MyNames', 'MyNamesPage'], ['Prices', 'PricesPage'], ['Stats', 'StatsPage']];
    for (const [route, type] of routes) {
      await t.frame.locator(`a[href="?${route}"]`).first().click();
      await t.frame.waitForFunction(type => Page.content.constructor.name === type, type);
      await layout(t, 'nav-' + route);
    }
    await t.frame.locator('a[href="?"]').first().click();
    await t.frame.locator('#register-name').waitFor();
    return routes.map(([route]) => route).concat('Register');
  } finally { await close(t); }
}

async function walletStates() {
  const results = [];
  for (const width of [1280, 390, 320]) {
    const t = await open(width, 'register', true);
    try {
      await installControlledState(t);
      await connect(t);
      const amount = await quote(t, 'qa-wallet-state');
      await refreshControlled(t, { balance: '0' });
      assert.match(await t.frame.locator('.registration-notice').innerText(), /Add EPIX to continue/);
      assert.equal(await t.frame.getByRole('button', { name: 'Register qa-wallet-state.epix', exact: true }).isDisabled(), true);
      await t.frame.getByRole('button', { name: 'How to get EPIX', exact: true }).click();
      assert.match(await t.frame.locator('.registration-funding').innerText(), /Epix network/);
      assert.match(await t.frame.locator('.registration-funding code').innerText(), /^epix1/);
      await layout(t, 'zero-balance-funding');
      await t.frame.getByRole('button', { name: 'Close funding help', exact: true }).click();
      await t.frame.evaluate(() => __testWallet.chain('0x1'));
      await t.frame.waitForFunction(() => Wallet.chainOk === false);
      await t.frame.locator('.registration-cost').getByRole('button', { name: /Switch wallet to Epix/ }).click();
      await t.frame.waitForFunction(() => Wallet.chainOk === true);
      await refreshControlled(t, { balance: String(BigInt(amount.fee) * 2n), failEstimate: true });
      assert.equal(await t.frame.evaluate(() => Page.pages.register.cost.networkFee), null);
      assert.match(await t.frame.locator('.registration-notice').innerText(), /estimate unavailable/i);
      await refreshControlled(t, { failEstimate: false, failBalance: true });
      assert.equal(await t.frame.evaluate(() => Page.pages.register.cost.balance), null);
      assert.match(await t.frame.locator('.registration-notice').innerText(), /Balance unavailable/);
      await refreshControlled(t, { failBalance: false, balance: String(BigInt(amount.fee) * 2n) });
      assert.equal(await t.frame.evaluate(() => Page.pages.register.cost.networkFee > 0n), true);
      await t.frame.evaluate(() => { __registrationFixture.balance = 0n; __testWallet.account('0x2222222222222222222222222222222222222222'); });
      await t.frame.waitForFunction(() => Wallet.address.toLowerCase() === '0x2222222222222222222222222222222222222222' && Page.pages.register.cost.balance === 0n);
      await t.frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await t.frame.getByRole('button', { name: 'Register qa-wallet-state.epix', exact: true }).isDisabled(), true);
      await layout(t, 'account-changed');
      results.push({ width, checks: ['zero balance blocks registration', 'funding help', 'wrong network and switch', 'unknown estimate is not zero', 'failed balance is not zero', 'account change discards old balance'] });
    } finally { await close(t); }
  }
  return results;
}

async function controlledTransactions() {
  const result = [];
  for (const flow of ['register', 'wizard']) {
    const t = await open(390, flow, true);
    try {
      await installControlledState(t);
      await connect(t);
      const amount = await quote(t, 'qa-simulated-register');
      await refreshControlled(t, { balance: String(BigInt(amount.fee) * 2n) });
      const register = t.frame.getByRole('button', { name: 'Register qa-simulated-register.epix', exact: true });
      // The write itself is replaced. No signer or wallet transaction method runs.
      await t.frame.evaluate(() => { __registrationFixture.writeError = new Error('failed to charge registration fee: spendable balance 0aepix is smaller than 10000000000000000000000aepix: insufficient funds: insufficient registration fee'); });
      await register.click();
      await t.frame.locator('.registration-error').waitFor();
      assert.match(await t.frame.locator('.registration-error').innerText(), /EPIX|balance|fund/i);
      await t.frame.locator('.registration-error').getByText('Technical details', { exact: true }).click();
      assert.match(await t.frame.locator('.registration-technical').innerText(), /failed to charge registration fee/);
      await layout(t, 'controlled-error-' + flow);
      await t.frame.getByRole('button', { name: 'Check balance and price', exact: true }).click();
      await t.frame.locator('.registration-error').waitFor({ state: 'hidden' });
      assert.equal(await t.frame.evaluate(() => __registrationFixture.writes.length), 1, 'Refreshing cost clears the old failed attempt without submitting again');
      await t.frame.evaluate(() => { __registrationFixture.writeError = null; });
      await register.click();
      await t.frame.waitForFunction(() => typeof __registrationFixture.pending === 'function');
      const input = t.frame.locator(flow === 'wizard' ? '#wizard-name' : '#register-name');
      await t.frame.waitForFunction(selector => document.querySelector(selector)?.disabled, flow === 'wizard' ? '#wizard-name' : '#register-name');
      assert.equal(await input.isDisabled(), true);
      await t.frame.evaluate(() => { const done = __registrationFixture.pending; __registrationFixture.pending = null; done(); });
      await t.frame.waitForFunction(flow => (flow === 'wizard' ? Page.pages.add_peer.registerTx : Page.pages.register.tx).isConfirming, flow);
      assert.equal(await input.isDisabled(), true);
      await t.frame.evaluate(() => { const done = __registrationFixture.pending; __registrationFixture.pending = null; done(); });
      await t.frame.waitForFunction(flow => (flow === 'wizard' ? Page.pages.add_peer.registerTx : Page.pages.register.tx).isSuccess, flow);
      if (flow === 'register') {
        await t.frame.getByRole('link', { name: 'Manage your name', exact: true }).waitFor();
        assert.match(await t.frame.locator('.RegisterPage').innerText(), /qa-simulated-register.epix is yours/);
      } else {
        await t.frame.getByRole('button', { name: 'Link identity', exact: true }).waitFor();
        assert.match(await t.frame.locator('.AddPeerPage').innerText(), /Name registered. Complete the link/);
        assert.equal(await t.frame.evaluate(() => __registrationFixture.writes.filter(write => write.fn === 'linkIdentity').length), 0);
      }
      await layout(t, 'controlled-confirmed-' + flow);
      result.push({ flow, writes: await t.frame.evaluate(() => __registrationFixture.writes), signingRequests: 0 });
    } finally { await close(t); }
  }
  return result;
}

async function existingNameWizard() {
  const t = await open(390, 'wizard', true);
  try {
    await installControlledState(t, [{ name: 'qa-owned-a', tld: 'epix' }, { name: 'qa-owned-b', tld: 'epix' }]);
    await connect(t);
    const choices = t.frame.locator('.select-row');
    await choices.first().waitFor();
    assert.equal(await choices.count(), 2);
    assert.equal(await choices.first().getAttribute('aria-pressed'), 'true');
    assert.match(await choices.first().innerText(), /Primary/);
    await choices.nth(1).click();
    await t.frame.getByRole('button', { name: 'Continue with qa-owned-b.epix', exact: true }).click();
    assert.match(await t.frame.locator('.AddPeerPage').innerText(), /no new registration|no registration|network fee/i);
    await t.frame.getByRole('button', { name: 'Change name or register another', exact: true }).click();
    await t.frame.getByRole('button', { name: 'Register a new name', exact: true }).click();
    await quote(t, 'qa-tier-preview');
    await t.frame.locator('.fee-toggle').click();
    await t.frame.waitForFunction(() => !Page.pages.add_peer.tiersLoading && Page.pages.add_peer.priceTiers.length > 0);
    await t.frame.locator('.tiers-box tbody tr').first().waitFor();
    assert.ok(await t.frame.locator('.tiers-box tbody tr').count() > 0);
    const tiers = await t.frame.evaluate(() => Page.pages.add_peer.priceTiers.map(row => ({ max_length: row.max_length, price: String(row.price) })));
    await t.frame.getByRole('button', { name: 'Close registration', exact: true }).click();
    await t.frame.getByRole('button', { name: 'Continue with qa-owned-b.epix', exact: true }).click();
    await t.page.clock.install();
    await t.frame.getByRole('button', { name: 'Link identity', exact: true }).click();
    await t.frame.waitForFunction(() => typeof __registrationFixture.pending === 'function');
    await t.frame.evaluate(() => { const done = __registrationFixture.pending; __registrationFixture.pending = null; done(); });
    await t.frame.waitForFunction(() => Page.pages.add_peer.linkTx.isConfirming);
    await t.frame.evaluate(() => { const done = __registrationFixture.pending; __registrationFixture.pending = null; done(); });
    await t.frame.waitForFunction(() => Page.pages.add_peer.linkStatus === 'polling');
    await t.page.clock.fastForward(61000);
    await t.frame.getByRole('button', { name: 'Retry confirmation', exact: true }).waitFor();
    assert.equal(await t.frame.evaluate(() => Page.pages.add_peer.nodeRecorded), false);
    assert.equal(new URL(t.page.url()).pathname, new URL(base).pathname, 'Unconfirmed link must not redirect');
    await layout(t, 'controlled-node-retry');
    await t.frame.evaluate(() => { __registrationFixture.nodeReady = true; });
    await t.frame.getByRole('button', { name: 'Retry confirmation', exact: true }).click();
    await t.frame.waitForFunction(() => Page.pages.add_peer.linkStatus === 'ready' && Page.pages.add_peer.nodeRecorded);
    const writes = await t.frame.evaluate(() => __registrationFixture.writes);
    assert.deepEqual(writes.map(write => write.fn), ['linkIdentity'], 'Retry confirmation must not register or link twice');
    await layout(t, 'controlled-node-ready');
    // Keep the return path intact without navigating away from the isolated UI.
    assert.equal(await t.frame.evaluate(() => Page.pages.add_peer.returnTo), '/Config?tab=identity');
    await t.frame.evaluate(() => Page.pages.add_peer.stopTimers());
    return { tiers, writes, confirmationCommands: await t.frame.evaluate(() => __registrationFixture.commands), returnTo: '/Config?tab=identity' };
  } finally { await close(t); }
}

async function themesAndWidths() {
  const results = [];
  for (const width of [1280, 390, 320]) for (const flow of ['register', 'wizard']) {
    const t = await open(width, flow, flow === 'wizard');
    try {
      if (flow === 'wizard') await connect(t);
      if (width === 320) {
        await quote(t, 'qa' + 'a'.repeat(62) + '.EPIX');
        await layout(t, 'maximum-name-' + flow);
      }
      await quote(t, 'qa-layout-review');
      const colors = [];
      for (const theme of ['light', 'dark']) {
        // This changes only the isolated document's theme classes, never the
        // real user's global theme setting or operating-system preference.
        await t.frame.evaluate(theme => {
          document.body.classList.remove('theme-light', 'theme-dark');
          document.body.classList.add('theme-' + theme);
        }, theme);
        const geometry = await layout(t, 'theme-' + flow + '-' + theme);
        colors.push(await t.frame.locator('.registration-card').evaluate(element => ({ background: getComputedStyle(element.closest('.card')).backgroundColor, foreground: getComputedStyle(element).color })));
        results.push({ width, flow, theme, geometry });
      }
      assert.notEqual(colors[0].background, colors[1].background, 'Card responds to explicit theme changes');
      assert.notEqual(colors[0].foreground, colors[1].foreground, 'Text responds to explicit theme changes');
    } finally { await close(t); }
  }
  return results;
}

(async () => {
  browser = await chromium.launch({ headless: true });
  try {
    await runGroup('live-quotes', 'live read-only RPC, test wallet connection only for wizard', liveReads);
    await runGroup('navigation', 'actual server read-only routes', navigation);
    await runGroup('wallet-states', 'controlled wallet balance and gas responses', walletStates);
    await runGroup('transaction-states', 'controlled transaction simulation, no signer', controlledTransactions);
    await runGroup('existing-name-link', 'controlled ownership, linking and node confirmation; live pricing tiers', existingNameWizard);
    await runGroup('themes-layout', 'actual server CSS and live quotes; isolated document theme changes', themesAndWidths);
  } catch (error) {
    report.error = error.stack;
    process.exitCode = 1;
    console.error(error.stack);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    for (const context of contexts) await context.close();
    await browser.close();
    console.log('Results: ' + path.join(output, 'results.json'));
  }
})();
