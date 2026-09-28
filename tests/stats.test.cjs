const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(fetchStats = async () => ({ ok: true, data: snapshot() })) {
  const context = { Intl, Date, Rest: { stats: fetchStats }, Page: { render() {}, handleLinkClick() {} } };
  context.window = context;
  context.h = function (selector, properties, children) {
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      children = properties;
      properties = {};
    }
    return { selector, properties, children: [children].flat().filter(value => value !== null && value !== undefined) };
  };
  vm.createContext(context);
  for (const file of ['js/utils/Format.js', 'js/pages/StatsPage.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  return context;
}

function snapshot(overrides = {}) {
  return {
    total_names: '4',
    total_fees_burned: '100000000000000000000',
    tld_stats: [
      { tld: 'test', name_count: '1', fees_burned: '10000000000000000000', enabled: false },
      { tld: 'epix', name_count: '3', fees_burned: '90000000000000000000', enabled: true }
    ],
    ...overrides
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...tree.children.flatMap(nodes)];
}

function text(tree) {
  if (tree === null || tree === undefined) return '';
  if (typeof tree !== 'object') return String(tree);
  return tree.children.map(text).join(' ');
}

test('token values retain precision above Number.MAX_SAFE_INTEGER and down to one aepix', () => {
  const { Format } = setup();
  assert.equal(Format.epix('900719925474099312345678901234567890', 'en-US'), '900,719,925,474,099,312.34567890123456789');
  assert.equal(Format.burned('1', 'en-US'), '0.000000000000000001');
  assert.equal(Format.burned('1234567890123456789', 'de-DE'), '1,234567890123456789');
  assert.equal(Format.burned('999999999999999999', 'en-US', 4), '1');
  assert.equal(Format.burned('900719925474099312345678901234567890', 'en-US', 4), '900,719,925,474,099,312.3457');
  assert.equal(Format.integer('18446744073709551615', 'en-US'), '18,446,744,073,709,551,615');
  assert.equal(Format.burned('broken'), 'Unavailable');
  assert.equal(Format.burned(null), 'Unavailable');
  assert.throws(() => Format.integer(Number.MAX_SAFE_INTEGER + 1));
});

test('summary derives a lifetime mean, enabled TLD count and sorted distribution', () => {
  const { StatsPage } = setup();
  const s = StatsPage.summarize(snapshot());
  assert.equal(s.totalNames, 4n);
  assert.equal(s.totalBurned, 100000000000000000000n);
  assert.equal(s.averageBurned, 25000000000000000000n);
  assert.equal(s.averageApproximate, false);
  assert.equal(s.activeTlds, 1);
  assert.equal(s.tlds[0].tld, 'epix');
  assert.equal(s.tlds[0].share, 75);
  assert.equal(s.tlds[1].share, 25);
});

test('summary preserves large counts and flags averages below base-unit precision', () => {
  const { StatsPage } = setup();
  const total = 18446744073709551615n;
  const s = StatsPage.summarize(snapshot({ total_names: total.toString(), total_fees_burned: (total * 3000000000000000000n + 1n).toString(), tld_stats: [] }));
  assert.equal(s.totalNames, total);
  assert.equal(s.averageBurned, 3000000000000000000n);
  assert.equal(s.averageApproximate, true);
});

test('empty chains have no average and zero distribution instead of NaN', async () => {
  const data = snapshot({ total_names: '0', total_fees_burned: '0', tld_stats: [{ tld: 'epix', name_count: '0', fees_burned: '0', enabled: true }] });
  const { StatsPage } = setup(async () => ({ ok: true, data }));
  const page = new StatsPage();
  await page.fetchStats();
  assert.equal(page.stats.averageBurned, null);
  assert.equal(page.stats.tlds[0].share, 0);
  const rendered = text(page.render());
  assert.match(rendered, /No registrations yet/);
  assert.match(rendered, /Not yet available/);
  assert.doesNotMatch(rendered, /NaN|Infinity/);
});

test('malformed statistics are rejected instead of displayed as zero totals', () => {
  const { StatsPage } = setup();
  for (const data of [null, {}, snapshot({ total_names: '-1' }), snapshot({ total_fees_burned: '' }), snapshot({ tld_stats: {} }), snapshot({ total_names: Number.MAX_SAFE_INTEGER + 1 })]) {
    assert.throws(() => StatsPage.summarize(data), /Invalid statistics response/);
  }
});

test('a positive average below display precision is distinguished from zero', async () => {
  const data = snapshot({ total_names: '3', total_fees_burned: '1', tld_stats: [] });
  const { StatsPage } = setup(async () => ({ ok: true, data }));
  const page = new StatsPage();
  await page.fetchStats();
  assert.equal(page.stats.averageBurned, 0n);
  assert.match(text(page.render()), /<0\.0001/);
  assert.match(text(page.render()), /No top-level domains configured/);
});

test('initial failure exposes a native retry button and a retry recovers', async () => {
  let calls = 0;
  const { StatsPage } = setup(async () => ++calls === 1 ? { ok: false, status: 503 } : { ok: true, data: snapshot() });
  const page = new StatsPage();
  await page.fetchStats();
  assert.equal(page.stats, null);
  assert.equal(page.loading, false);
  const rendered = page.render();
  assert.ok(nodes(rendered).some(node => node.properties.role === 'alert'));
  const retry = nodes(rendered).find(node => node.selector.startsWith('button') && text(node) === 'Retry');
  assert.ok(retry);
  assert.equal(retry.properties.onclick, page.handleRefresh);
  await page.fetchStats();
  assert.equal(page.error, '');
  assert.equal(page.stats.totalNames, 4n);
  assert.ok(page.refreshedAt instanceof Date);
});

test('failed refresh retains the last good values and timestamp, then recovers', async () => {
  let calls = 0;
  const { StatsPage } = setup(async () => {
    calls += 1;
    if (calls === 2) throw new Error('offline');
    return { ok: true, data: snapshot({ total_names: calls === 3 ? '5' : '4' }) };
  });
  const page = new StatsPage();
  await page.fetchStats();
  const previous = page.stats;
  const refreshedAt = page.refreshedAt;
  await page.fetchStats();
  assert.equal(page.stats, previous);
  assert.equal(page.refreshedAt, refreshedAt);
  assert.match(page.error, /last successful snapshot/);
  await page.fetchStats();
  assert.equal(page.stats.totalNames, 5n);
  assert.equal(page.error, '');
});

test('refresh cannot issue overlapping requests and exposes its loading state', async () => {
  let resolve;
  let calls = 0;
  const { StatsPage } = setup(() => { calls += 1; return new Promise(done => { resolve = done; }); });
  const page = new StatsPage();
  const pending = page.fetchStats();
  await page.fetchStats();
  assert.equal(calls, 1);
  const rendered = page.render();
  assert.equal(rendered.properties['aria-busy'], 'true');
  const refresh = nodes(rendered).find(node => node.selector.startsWith('button'));
  assert.equal(refresh.properties.disabled, true);
  resolve({ ok: true, data: snapshot() });
  await pending;
  assert.equal(page.loading, false);
});
