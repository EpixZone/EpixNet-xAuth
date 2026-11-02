const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/utils/ProfileAvatar.js'), 'utf8');
const png = 'data:image/png;base64,AA==';
const tick = () => new Promise(resolve => setImmediate(resolve));

// Reopen the same wrapper storage in a fresh inner frame. Only a processed
// thumbnail should cross that boundary; the on-chain source remains a URL.
function open(storage = { state: { other: 'keep' } }, time = Date.now(), shared = async () => null) {
  const samples = [], filters = [];
  const context = {
    h: (selector, props) => props, URL, setTimeout, clearTimeout, Date: { now: () => time },
    EpixAvatar: { get: shared },
    document: {
      baseURI: 'https://xid.content.epix/',
      createElement: () => ({
        getContext: () => ({ drawImage: (...params) => samples.push(params.slice(1)) }),
        toDataURL: () => png
      })
    },
    pica: () => ({ resize: async (from, to, options) => filters.push([from.width, from.height, to.width, to.height, options.filter]) })
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/lib/epixframe.js'), 'utf8'), context);
  context.Page = Object.create(context.EpixFrame.prototype);
  context.Page.isEmbedded = true;
  context.Page.cmd = async function (name, params) {
    if (name === 'wrapperGetLocalStorage') return structuredClone(storage.state);
    assert.equal(name, 'wrapperSetLocalStorage');
    storage.state = structuredClone(params);
  };
  vm.runInContext(source, context);
  const props = url => context.ProfileAvatar.render(url, 'avatar');
  async function mount(url, width = 2048, height = width) {
    const view = props(url);
    const image = {
      naturalWidth: width, naturalHeight: height, isConnected: true, style: {},
      getAttribute: key => view[key], removeAttribute() { this.crossOrigin = undefined; }
    };
    await view.afterCreate(image);
    return image;
  }
  return { props, mount, samples, filters };
}

test('request the CSS size for numbered and legacy Gravatar URLs, preserving other parameters', async () => {
  const hash = '0123456789abcdef'.repeat(2), { mount } = open();
  for (const host of ['2.gravatar.com', 'www.gravatar.com', 'gravatar.com', 'secure.gravatar.com']) {
    const original = `https://${host}/avatar/${hash}.jpg?size=2048&s=1024&s=512&r=pg&d=https%3A%2F%2Fexample.org%2Fpic.png`;
    const result = new URL((await mount(original)).src);
    assert.equal(result.hostname, host);
    assert.deepEqual(result.searchParams.getAll('s'), ['56']);
    assert.equal(result.searchParams.has('size'), false);
    assert.equal(result.searchParams.get('r'), 'pg');
    assert.equal(result.searchParams.get('d'), 'https://example.org/pic.png');
  }
  for (const url of [`https://gravatar.com.example/avatar/${hash}?s=256`, 'https://gravatar.com/account?size=256', `https://example.com/avatar/${hash}`]) {
    assert.equal((await mount(url)).src, url);
  }
});

test('a shared cache hit uses the original profile URL and avoids a local image download and resize', async () => {
  const source = 'https://2.gravatar.com/avatar/' + 'a'.repeat(64) + '?size=2048';
  const storage = { state: { other: 'keep' } };
  const requests = [];
  const frame = open(storage, Date.now(), async (url, size, page) => {
    requests.push([url, size, page.isEmbedded]);
    return png;
  });
  const image = await frame.mount(source);
  assert.equal(image.src, png);
  assert.deepEqual(requests, [[source, 56, true]]);
  assert.equal(image.crossOrigin, undefined);
  assert.equal(frame.samples.length, 0);
  assert.deepEqual(storage.state, { other: 'keep' });
});

test('existing local thumbnails and remembered display-only origins do not cause a shared fetch on upgrade', async () => {
  const source = 'https://example.org/avatar';
  for (const local of [png, null]) {
    const storage = { state: { 'xid.avatar-thumbnails.v1': [{ url: source, png: local, expires: Date.now() + 60000 }] } };
    const frame = open(storage, Date.now(), () => { throw new Error('unexpected shared lookup'); });
    const image = await frame.mount(source);
    assert.equal(image.src, local || source);
  }
});

test('a large panorama is center-cropped into a bounded raster, filtered, and reused by new frames until it expires', async () => {
  const url = 'https://example.org/panorama.png', storage = { state: { other: 'keep' } }, now = Date.now();
  const frame = open(storage, now);
  const image = await frame.mount(url, 24000, 12000);
  assert.equal(image.src, url);
  await image.onload();
  await tick();
  assert.deepEqual(frame.samples, [[6000, 0, 12000, 12000, 0, 0, 512, 512]]);
  assert.deepEqual(frame.filters, [[512, 512, 56, 56, 'lanczos3']]);
  assert.equal(storage.state.other, 'keep');
  assert.equal((await open(storage, now + 1000).mount(url)).src, png);
  assert.equal((await open(storage, now + 1000).mount(url + '?v=2')).src, url + '?v=2');
  assert.equal((await open(storage, now + 86400001).mount(url)).src, url);
});

test('unreadable hosts retain ordinary image display, remembering the fallback without saving their bytes', async () => {
  const url = 'https://example.org/no-cors', storage = { state: {} };
  const image = await open(storage).mount(url);
  image.onerror();
  assert.equal(image.crossOrigin, undefined);
  assert.equal(image.src, url);
  image.onload();
  await tick();
  const next = await open(storage).mount(url);
  assert.equal(next.src, url);
  assert.equal(next.crossOrigin, undefined);
  assert.equal(storage.state['xid.avatar-thumbnails.v1'][0].png, null);
});

test('a full thumbnail cache evicts the oldest URL and keeps smaller images at their native resolution', async () => {
  const storage = { state: {} }, frame = open(storage);
  for (let n = 0; n < 34; n++) {
    const image = await frame.mount('https://example.org/' + n, 24);
    await image.onload();
  }
  await tick();
  assert.equal(frame.filters.length, 0);
  assert.equal(storage.state['xid.avatar-thumbnails.v1'].length, 32);
  assert.equal((await open(storage).mount('https://example.org/0')).src, 'https://example.org/0');
  assert.equal((await open(storage).mount('https://example.org/33')).src, png);
});
