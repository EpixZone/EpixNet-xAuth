const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '../js/lib/epixkit.js'), 'utf8');
const address = '0x1111111111111111111111111111111111111111';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function setup(request, origin = 'http://127.0.0.1:42222') {
  const elements = new Map();
  class Element {
    children = []; style = {}; listeners = {}; _html = ''; parent = null; isConnected = true;
    appendChild(child) { child.parent = this; this.children.push(child); if (child.id) elements.set(child.id, child); }
    set innerHTML(value) {
      for (const child of this.children) { child.parent = null; child.isConnected = false; }
      this._html = value; this.children = [];
      for (const match of value.matchAll(/id="([^"]+)"/g)) { const el = new Element(); el.parent = this; elements.set(match[1], el); }
    }
    focus() { document.activeElement = this; }
    contains(el) { for (; el; el = el.parent) if (el === this) return true; return false; }
    getClientRects() { return [{}]; }
    // The focusable controls: the close button, then the wallet buttons.
    querySelectorAll() { return [this.querySelector('.epixkit-close'), ...elements.get('epixkit-list').children]; }
    get innerHTML() { return this._html || this.children.map(child => child.textContent || '').join(''); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    querySelector(selector) {
      const key = this.id + selector;
      if (!elements.has(key)) { const el = new Element(); el.parent = this; elements.set(key, el); }
      return elements.get(key);
    }
  }
  const events = new Map(), storage = new Map(), calls = [];
  const trigger = new Element();
  const document = { head: new Element(), body: new Element(), activeElement: trigger, createElement: () => new Element(), createTextNode: text => ({ textContent: text }), getElementById: id => elements.get(id) };
  const context = {
    console, Event, Promise, setTimeout, clearTimeout, document,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    origin,
    addEventListener(name, fn) { events.set(name, fn); },
    dispatchEvent() {},
  };
  context.window = context;
  if (request) context.ethereum = { isMetaMask: true, request(args) { calls.push(args); return request(args); } };
  vm.runInNewContext(source, context);
  context.EpixKit.init({ chainId: '0x77c', requestTimeoutMs: 30 });
  async function connect() {
    const result = context.EpixKit.connect().then(value => ({ value }), error => ({ error }));
    await delay(175);
    const list = elements.get('epixkit-list');
    if (list.children.length) { list.children[0].focus(); list.children[0].onclick(); }
    await delay(0);
    return { result };
  }
  const close = () => elements.get('epixkit-modal').querySelector('.epixkit-close').listeners.click();
  const key = (k, shiftKey = false) => {
    const event = { key: k, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
    elements.get('epixkit-modal').listeners.keydown(event);
    return event;
  };
  return { context, document, trigger, elements, calls, storage, connect, close, key };
}

const success = ({ method }) => Promise.resolve(method === 'eth_accounts' || method === 'eth_requestAccounts' ? [address] : null);

test('an unresponsive wallet times out, explains restricted frames, and can be retried', async () => {
  let respond = false;
  const t = setup(args => respond ? success(args) : new Promise(() => {}), 'null');
  const first = await t.connect();
  assert.match((await first.result).error.message, /restricted frame/);
  assert.equal(t.context.EpixKit.isConnected(), false);
  assert.match(t.elements.get('epixkit-list').innerHTML, /desktop EpixNet browser/);
  respond = true;
  const retry = await t.connect();
  assert.equal((await retry.result).value.address, address);
  assert.equal(t.context.EpixKit.isConnected(), true);
  assert.deepEqual(t.calls.map(call => call.method), ['eth_requestAccounts', 'eth_requestAccounts', 'wallet_switchEthereumChain', 'eth_accounts']);
});

test('closing a pending connection settles it and ignores a late wallet approval', async () => {
  let release;
  const t = setup(() => new Promise(resolve => { release = resolve; }));
  const first = await t.connect();
  t.close();
  assert.equal((await first.result).error.message, 'User cancelled');
  release([address]); await delay(5);
  assert.equal(t.context.EpixKit.isConnected(), false);
  assert.equal(t.storage.size, 0);
  assert.equal(t.calls.length, 1);
  assert.equal(t.elements.get('epixkit-modal').style.display, 'none');
});

test('network switching also times out instead of leaving a spinner', async () => {
  const t = setup(args => args.method === 'wallet_switchEthereumChain' ? new Promise(() => {}) : success(args));
  const connection = await t.connect();
  assert.match((await connection.result).error.message, /wallet did not respond/);
  assert.equal(t.context.EpixKit.isConnected(), false);
});

test('unknown chains are added and the connected account is retained', async () => {
  const t = setup(args => args.method === 'wallet_switchEthereumChain' ? Promise.reject({ code: 4902 }) : success(args));
  const connection = await t.connect();
  assert.equal((await connection.result).value.address, address);
  assert.deepEqual(t.calls.map(call => call.method), ['eth_requestAccounts', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_accounts']);
});

test('an empty account list is an error, not a successful connection', async () => {
  const t = setup(args => args.method === 'eth_accounts' ? Promise.resolve([]) : success(args));
  const connection = await t.connect();
  assert.match((await connection.result).error.message, /did not share an account/);
  assert.equal(t.context.EpixKit.isConnected(), false);
});

test('the picker and no-wallet dialog can both be cancelled', async () => {
  for (const provider of [success, null]) {
    const t = setup(provider);
    const result = t.context.EpixKit.connect().catch(error => error.message);
    await delay(175); t.close();
    assert.match(await result, /User cancelled|No wallet detected/);
    assert.equal(t.calls.length, 0);
  }
});

test('a second simultaneous connection cannot replace the first request', async () => {
  const t = setup(() => new Promise(() => {}));
  const connection = await t.connect();
  await assert.rejects(t.context.EpixKit.connect(), /already in progress/);
  t.close(); await connection.result;
  assert.equal(t.calls.length, 1);
});

test('the picker is an accessible dialog that takes focus and returns it', async () => {
  const t = setup(() => new Promise(() => {}));
  const result = t.context.EpixKit.connect().catch(error => error.message);
  await delay(175);
  const modal = t.elements.get('epixkit-modal');
  assert.match(modal.innerHTML, /role="dialog" aria-modal="true" aria-labelledby="epixkit-title"/);
  assert.match(modal.innerHTML, /aria-label="Close wallet picker"/);
  assert.match(modal.innerHTML, /id="epixkit-title"/);
  const closeButton = modal.querySelector('.epixkit-close');
  assert.equal(t.document.activeElement, closeButton);
  t.close();
  assert.equal(await result, 'User cancelled');
  assert.equal(t.document.activeElement, t.trigger);
});

test('Escape closes the picker and rejects the connection', async () => {
  const t = setup(success);
  const result = t.context.EpixKit.connect().catch(error => error.message);
  await delay(175);
  const event = t.key('Escape');
  assert.equal(event.prevented, true);
  assert.equal(await result, 'User cancelled');
  assert.equal(t.elements.get('epixkit-modal').style.display, 'none');
  assert.equal(t.document.activeElement, t.trigger);
  assert.equal(t.calls.length, 0);
});

test('Escape cancels a pending wallet request from the connecting view', async () => {
  let release;
  const t = setup(() => new Promise(resolve => { release = resolve; }));
  const connection = await t.connect();
  // The wallet button that had focus was replaced by the connecting view.
  assert.equal(t.document.activeElement, t.elements.get('epixkit-modal').querySelector('.epixkit-close'));
  t.key('Escape');
  assert.equal((await connection.result).error.message, 'User cancelled');
  release([address]); await delay(5);
  assert.equal(t.context.EpixKit.isConnected(), false);
  assert.equal(t.document.activeElement, t.trigger);
});

test('Tab and Shift+Tab are trapped inside the picker', async () => {
  const t = setup(success);
  const result = t.context.EpixKit.connect().catch(error => error.message);
  await delay(175);
  const closeButton = t.elements.get('epixkit-modal').querySelector('.epixkit-close');
  const walletButton = t.elements.get('epixkit-list').children[0];
  assert.equal(t.document.activeElement, closeButton);
  assert.equal(t.key('Tab', true).prevented, true);
  assert.equal(t.document.activeElement, walletButton);
  assert.equal(t.key('Tab').prevented, true);
  assert.equal(t.document.activeElement, closeButton);
  // Other keys are left alone.
  assert.equal(t.key('Enter').prevented, false);
  assert.equal(t.document.activeElement, closeButton);
  t.close();
  assert.equal(await result, 'User cancelled');
});

test('focus returns to the trigger after a successful connection', async () => {
  const t = setup(success);
  const connection = await t.connect();
  assert.equal((await connection.result).value.address, address);
  assert.equal(t.elements.get('epixkit-modal').style.display, 'none');
  assert.equal(t.document.activeElement, t.trigger);
});

test('the no-wallet dialog also takes focus and closes on Escape', async () => {
  const t = setup(null);
  const result = t.context.EpixKit.connect().catch(error => error.message);
  await delay(175);
  assert.equal(t.document.activeElement, t.elements.get('epixkit-modal').querySelector('.epixkit-close'));
  t.key('Escape');
  assert.equal(await result, 'No wallet detected');
  assert.equal(t.document.activeElement, t.trigger);
});
