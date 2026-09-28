const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(fetchStats = async () => ({ ok: true, data: snapshot() }), fetchRecent = async () => []) {
  const context = {
    Intl, Date,
    Rest: { stats: fetchStats, latestRegistrations: fetchRecent },
    Page: { render() {}, handleLinkClick() {}, nameUrl: (tld, name) => '?Name:' + tld + ':' + name }
  };
  context.window = context;
  context.h = function (selector, properties, children) {
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      children = properties;
      properties = {};
    }
    return { selector, properties, children: [children].flat().filter(value => value !== null && value !== undefined) };
  };
  vm.createContext(context);
  for (const file of ['js/utils/Format.js', 'js/wallet/Chain.js', 'js/pages/StatsPage.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  }
  context.Chain.initDefaults();
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

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function registration(index, overrides = {}) {
  return {
    name: 'person-' + index,
    tld: 'epix',
    txHash: String(index).padStart(64, 'A'),
    timestamp: '2026-09-28T12:34:0' + index + 'Z',
    height: String(500 + index),
    ...overrides
  };
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

test('the fees-burned card links to the original explorer account after loading and a failed refresh', async () => {
  let calls = 0;
  const { StatsPage } = setup(async () => {
    if (++calls > 1) throw new Error('offline');
    return { ok: true, data: snapshot() };
  });
  const page = new StatsPage();
  // Fixed destination from the original card, with the real Chain helper
  // loaded above. An inner CTA alone must not replace the clickable card.
  const expectedHref = '/epix1epxrwflutk4j2saxuy84wvv52tdepuep8yqcqk/?account=epix1gs90m79353yufdyqrl93yklqgcg0s6cfdcjv7h';
  const assertBurnCardLink = () => {
    const cards = nodes(page.render()).filter(node => node.selector.split(/[.#]/)[0] === 'a' && text(node).includes('Registration fees burned'));
    assert.equal(cards.length, 1, 'the entire fees-burned metric must remain a native link');
    const card = cards[0];
    assert.equal(card.properties.href, expectedHref);
    assert.equal(card.properties.target, '_blank');
    assert.match(card.properties.rel, /\b(?:noreferrer|noopener)\b/);
    assert.match(text(card), /\b100\b/);
    assert.match(text(card), /View burn transactions/);
  };

  await page.fetchStats();
  assert.equal(page.error, '');
  assertBurnCardLink();
  await page.fetchStats();
  assert.match(page.error, /last successful snapshot/);
  assertBurnCardLink();
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

test('recent registrations request five records and display names, local dates, and Cosmos explorer links', async () => {
  const records = Array.from({ length: 5 }, (_, i) => registration(i));
  const requested = [];
  const c = setup(undefined, async count => { requested.push(count); return records; });
  const page = new c.StatsPage();
  await page.fetchRecentRegistrations();
  assert.deepEqual(requested, [5]);
  assert.equal(page.recentError, '');
  assert.ok(page.recentRefreshedAt instanceof Date);
  const rendered = page.renderRecentRegistrations();
  const nameLinks = nodes(rendered).filter(node => node.selector.startsWith('a') && node.properties.onclick === c.Page.handleLinkClick);
  assert.equal(nameLinks.length, 5);
  const transactionLinks = nodes(rendered).filter(node => node.selector.startsWith('a') && node.properties.target === '_blank');
  assert.equal(transactionLinks.length, 5);
  for (let i = 0; i < records.length; i++) {
    const entry = records[i];
    assert.equal(nameLinks[i].properties.href, '?Name:epix:' + entry.name);
    assert.equal(text(nameLinks[i]), entry.name + '.epix');
    assert.equal(transactionLinks[i].properties.href, '/epix1epxrwflutk4j2saxuy84wvv52tdepuep8yqcqk/?tx=' + entry.txHash);
    assert.equal(transactionLinks[i].properties.title, entry.txHash);
    assert.match(transactionLinks[i].properties.rel, /\bnoopener\b/);
    assert.match(transactionLinks[i].properties['aria-label'], /opens in a new tab/);
    const date = nodes(rendered).find(node => node.selector === 'time' && node.properties.datetime === entry.timestamp);
    assert.ok(date);
    assert.equal(text(date), new Date(entry.timestamp).toLocaleString());
  }
});

test('the recent list remains bounded to five and supports multiple names in one transaction', async () => {
  const hash = 'AB'.repeat(32);
  const c = setup(undefined, async () => Array.from({ length: 7 }, (_, i) => registration(i, { txHash: hash })));
  const page = new c.StatsPage();
  await page.fetchRecentRegistrations();
  assert.equal(page.recentRegistrations.length, 5);
  const rows = nodes(page.renderRecentRegistrations()).filter(node => node.selector === 'tr' && node.properties.key);
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map(row => row.properties.key)).size, 5);
  assert.ok(rows.every(row => nodes(row).some(node => node.properties.href === c.Chain.explorerTxUrl(hash))));
});

test('recent loading is announced and duplicate refreshes cannot overlap', async () => {
  const pending = deferred();
  let calls = 0;
  const { StatsPage } = setup(undefined, () => { calls++; return pending.promise; });
  const page = new StatsPage();
  const request = page.fetchRecentRegistrations();
  await page.fetchRecentRegistrations();
  assert.equal(calls, 1);
  assert.equal(page.recentRegistrations, null);
  const recent = page.renderRecentRegistrations();
  assert.equal(recent.properties['aria-busy'], 'true');
  assert.ok(nodes(recent).some(node => node.properties.role === 'status' && /Loading registrations/.test(text(node))));
  const refresh = nodes(page.render()).find(node => node.selector.startsWith('button') && /Refreshing/.test(text(node)));
  assert.ok(refresh);
  assert.equal(refresh.properties.disabled, true);
  assert.doesNotMatch(text(recent), /No indexed registrations/);
  pending.resolve([registration(1)]);
  await request;
  assert.equal(page.recentLoading, false);
  assert.equal(page.renderRecentRegistrations().properties['aria-busy'], 'false');
});

test('recent failures leave chain totals available and offer a separate native retry', async () => {
  let calls = 0;
  const { StatsPage } = setup(undefined, async () => {
    if (++calls === 1) throw new Error('transaction indexing unavailable');
    return [registration(1)];
  });
  const page = new StatsPage();
  page.enter(); await flush();
  assert.equal(page.stats.totalNames, 4n);
  assert.equal(page.error, '');
  assert.equal(page.recentRegistrations, null);
  assert.equal(page.recentLoading, false);
  const recent = page.renderRecentRegistrations();
  assert.ok(nodes(recent).some(node => node.properties.role === 'alert'));
  assert.doesNotMatch(text(recent), /No indexed registrations/);
  const retry = nodes(recent).find(node => node.selector.startsWith('button') && text(node) === 'Retry registrations');
  assert.ok(retry);
  assert.equal(retry.properties.type, 'button');
  await retry.properties.onclick();
  assert.equal(calls, 2);
  assert.equal(page.recentError, '');
  assert.equal(page.recentRegistrations[0].name, 'person-1');
});

test('recent registrations still load when chain counters fail', async () => {
  const { StatsPage } = setup(async () => { throw new Error('stats unavailable'); }, async () => [registration(2)]);
  const page = new StatsPage();
  page.handleRefresh(); await flush();
  assert.equal(page.stats, null);
  assert.match(page.error, /Could not refresh chain statistics/);
  assert.equal(page.recentError, '');
  assert.match(text(page.render()), /person-2\.epix/);
});

test('a failed recent refresh retains the list and its successful timestamp until retry succeeds', async () => {
  let calls = 0;
  const pending = deferred();
  const { StatsPage } = setup(undefined, async () => {
    if (++calls === 1) return [registration(1)];
    if (calls === 2) return pending.promise;
    return [registration(3)];
  });
  const page = new StatsPage();
  await page.fetchRecentRegistrations();
  const records = page.recentRegistrations, refreshedAt = page.recentRefreshedAt;
  const refresh = page.fetchRecentRegistrations();
  assert.match(text(page.renderRecentRegistrations()), /Refreshing registrations/);
  assert.match(text(page.renderRecentRegistrations()), /person-1\.epix/);
  pending.reject(new Error('offline'));
  await refresh;
  assert.equal(page.recentRegistrations, records);
  assert.equal(page.recentRefreshedAt, refreshedAt);
  assert.match(page.recentError, /last successful list/);
  assert.match(text(page.renderRecentRegistrations()), /person-1\.epix/);
  await page.fetchRecentRegistrations();
  assert.equal(page.recentError, '');
  assert.equal(page.recentRegistrations[0].name, 'person-3');
  assert.notEqual(page.recentRefreshedAt, refreshedAt);
});

test('an empty transaction index is shown only after a successful response', async () => {
  const { StatsPage } = setup();
  const page = new StatsPage();
  assert.doesNotMatch(text(page.renderRecentRegistrations()), /No indexed registrations/);
  await page.fetchRecentRegistrations();
  assert.match(text(page.renderRecentRegistrations()), /No indexed registrations are available from this node yet/);
  assert.equal(page.recentError, '');
  assert.ok(page.recentRefreshedAt instanceof Date);
  assert.equal(nodes(page.renderRecentRegistrations()).filter(node => node.selector.startsWith('table')).length, 0);
});
