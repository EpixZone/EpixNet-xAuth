const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(fetchStats = async () => ({ ok: true, data: snapshot() }), fetchRecent = async () => [], isEmbedded = true) {
  const clock = fakeClock();
  const context = {
    Intl, Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    Rest: { stats: fetchStats },
    XidDirectory: { latest: fetchRecent },
    Page: { isEmbedded, render() {}, handleLinkClick() {}, nameUrl: (tld, name) => '?Name:' + tld + ':' + name }
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
  context.clock = clock;
  return context;
}

function fakeClock() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    }
  };
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
function xid(index, overrides = {}) {
  return {
    name: 'person-' + index,
    tld: 'epix',
    timestamp: '2026-09-28T12:34:0' + index + 'Z',
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

test('recent xIDs request five records and display names and local data-update dates', async () => {
  const records = Array.from({ length: 5 }, (_, i) => xid(i));
  const requested = [];
  const c = setup(undefined, async count => { requested.push(count); return records; });
  const page = new c.StatsPage();
  await page.fetchRecentXids();
  assert.deepEqual(requested, [5]);
  assert.equal(page.recentError, '');
  assert.ok(page.recentRefreshedAt instanceof Date);
  const rendered = page.renderRecentXids();
  const nameLinks = nodes(rendered).filter(node => node.selector.startsWith('a') && node.properties.onclick === c.Page.handleLinkClick);
  assert.equal(nameLinks.length, 5);
  assert.match(text(rendered), /Latest xIDs/);
  assert.match(text(rendered), /locally available user data/);
  assert.match(text(rendered), /Last updated/);
  assert.doesNotMatch(text(rendered), /Latest registrations|Transaction|Registered/);
  for (let i = 0; i < records.length; i++) {
    const entry = records[i];
    assert.equal(nameLinks[i].properties.href, '?Name:epix:' + entry.name);
    assert.equal(text(nameLinks[i]), entry.name + '.epix');
    const date = nodes(rendered).find(node => node.selector === 'time' && node.properties.datetime === entry.timestamp);
    assert.ok(date);
    assert.equal(text(date), new Date(entry.timestamp).toLocaleString());
  }
});

test('the recent list remains bounded to five and identifies each name with its TLD', async () => {
  const records = Array.from({ length: 7 }, (_, i) => xid(i, { name: 'same-name', tld: 'tld' + i }));
  const c = setup(undefined, async () => records);
  const page = new c.StatsPage();
  await page.fetchRecentXids();
  assert.equal(page.recentXids.length, 5);
  const rows = nodes(page.renderRecentXids()).filter(node => node.selector === 'tr' && node.properties.key);
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map(row => row.properties.key)).size, 5);
  assert.ok(rows.every(row => nodes(row).filter(node => node.selector.startsWith('a')).length === 1));
});

test('recent loading is announced and duplicate refreshes cannot overlap', async () => {
  const pending = deferred();
  let calls = 0;
  const { StatsPage } = setup(undefined, () => { calls++; return pending.promise; });
  const page = new StatsPage();
  const request = page.fetchRecentXids();
  await page.fetchRecentXids();
  assert.equal(calls, 1);
  assert.equal(page.recentXids, null);
  const recent = page.renderRecentXids();
  assert.equal(recent.properties['aria-busy'], 'true');
  assert.ok(nodes(recent).some(node => node.properties.role === 'status' && /Loading xIDs/.test(text(node))));
  const refresh = nodes(page.render()).find(node => node.selector.startsWith('button') && /Refreshing/.test(text(node)));
  assert.ok(refresh);
  assert.equal(refresh.properties.disabled, true);
  assert.doesNotMatch(text(recent), /No xIDs are available/);
  pending.resolve([xid(1)]);
  await request;
  assert.equal(page.recentLoading, false);
  assert.equal(page.renderRecentXids().properties['aria-busy'], 'false');
});

test('recent failures leave chain totals available and offer a separate native retry', async () => {
  let calls = 0;
  const { StatsPage } = setup(undefined, async () => {
    if (++calls === 1) throw new Error('user data unavailable');
    return [xid(1)];
  });
  const page = new StatsPage();
  page.enter(); await flush();
  assert.equal(page.stats.totalNames, 4n);
  assert.equal(page.error, '');
  assert.equal(page.recentXids, null);
  assert.equal(page.recentLoading, false);
  const recent = page.renderRecentXids();
  assert.ok(nodes(recent).some(node => node.properties.role === 'alert'));
  assert.doesNotMatch(text(recent), /No xIDs are available/);
  const retry = nodes(recent).find(node => node.selector.startsWith('button') && text(node) === 'Retry xIDs');
  assert.ok(retry);
  assert.equal(retry.properties.type, 'button');
  await retry.properties.onclick();
  assert.equal(calls, 2);
  assert.equal(page.recentError, '');
  assert.equal(page.recentXids[0].name, 'person-1');
});

test('recent xIDs still load when chain counters fail', async () => {
  const { StatsPage } = setup(async () => { throw new Error('stats unavailable'); }, async () => [xid(2)]);
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
    if (++calls === 1) return [xid(1)];
    if (calls === 2) return pending.promise;
    return [xid(3)];
  });
  const page = new StatsPage();
  await page.fetchRecentXids();
  const records = page.recentXids, refreshedAt = page.recentRefreshedAt;
  const refresh = page.fetchRecentXids();
  assert.match(text(page.renderRecentXids()), /Refreshing xIDs/);
  assert.match(text(page.renderRecentXids()), /person-1\.epix/);
  pending.reject(new Error('offline'));
  await refresh;
  assert.equal(page.recentXids, records);
  assert.equal(page.recentRefreshedAt, refreshedAt);
  assert.match(page.recentError, /last successful list/);
  assert.match(text(page.renderRecentXids()), /person-1\.epix/);
  await page.fetchRecentXids();
  assert.equal(page.recentError, '');
  assert.equal(page.recentXids[0].name, 'person-3');
  assert.notEqual(page.recentRefreshedAt, refreshedAt);
});

test('an empty local directory is shown only after a successful response', async () => {
  const { StatsPage } = setup();
  const page = new StatsPage();
  assert.doesNotMatch(text(page.renderRecentXids()), /No xIDs are available/);
  await page.fetchRecentXids();
  assert.match(text(page.renderRecentXids()), /No xIDs are available in the local user data yet/);
  assert.equal(page.recentError, '');
  assert.ok(page.recentRefreshedAt instanceof Date);
  assert.equal(nodes(page.renderRecentXids()).filter(node => node.selector.startsWith('table')).length, 0);
});


test('standalone mode explains how to see xIDs without requesting wrapper data', async () => {
  let calls = 0;
  const { StatsPage } = setup(undefined, async () => { calls++; return [xid(1)]; }, false);
  const page = new StatsPage();
  page.enter(); await flush();
  await page.fetchRecentXids();
  assert.equal(calls, 0);
  assert.equal(page.recentLoading, false);
  assert.equal(page.recentXids, null);
  assert.equal(page.recentRefreshedAt, null);
  assert.equal(page.stats.totalNames, 4n);
  const recent = page.renderRecentXids();
  assert.equal(recent.properties['aria-busy'], 'false');
  assert.match(text(recent), /Open this xite in EpixNet to see recent xIDs/);
  assert.doesNotMatch(text(recent), /Loading xIDs|No xIDs are available|Retry xIDs/);
  assert.equal(nodes(recent).filter(node => node.selector.startsWith('table')).length, 0);
});


test('user data file events and completed updates refresh only the recent xID list', async () => {
  let statsCalls = 0, recentCalls = 0;
  const c = setup(async () => { statsCalls++; return { ok: true, data: snapshot() }; }, async () => [xid(++recentCalls)]);
  const page = new c.StatsPage();
  page.onSiteInfo({ event: ['updated'] });
  page.onReconnect();
  assert.equal(c.clock.timers.size, 0, 'an inactive page must not schedule refreshes');
  page.enter(); await flush();
  assert.equal(page.active, true);
  assert.equal(statsCalls, 1);
  assert.equal(recentCalls, 1);
  const events = [
    ['file_done', 'data/users/person.epix/content.json'],
    ['file_done', 'data/users/person.epix/data.json'],
    ['file_done', 'data/users/person.epix/data-auth123.json'],
    ['updated']
  ];
  for (const [index, event] of events.entries()) {
    page.onSiteInfo({ event });
    assert.equal(c.clock.timers.size, 1, event.join(':'));
    c.clock.advance(249);
    assert.equal(recentCalls, index + 1, 'refresh must wait for its coalescing delay');
    c.clock.advance(1); await flush();
    assert.equal(recentCalls, index + 2);
    assert.equal(c.clock.timers.size, 0);
  }
  assert.equal(statsCalls, 1, 'local data changes must not refetch chain counters');
});

test('unrelated or malformed site notifications do not refresh xIDs', async () => {
  let calls = 0;
  const c = setup(undefined, async () => { calls++; return []; });
  const page = new c.StatsPage();
  page.enter(); await flush();
  for (const info of [
    null, {}, { event: 'updated' }, { event: [] },
    { event: ['file_done'] }, { event: ['file_done', {}] },
    { event: ['file_started', 'data/users/person.epix/data.json'] },
    { event: ['file_done', 'data/users/person.epix/profile.json'] },
    { event: ['file_done', 'data/users/person.epix/data.json.backup'] },
    { event: ['file_done', 'data/users/person.epix/subdir/data.json'] },
    { event: ['file_done', 'data/users/content.json'] },
    { event: ['file_done', 'data/other/person.epix/data.json'] },
    { event: ['file_done', 'content.json'] }
  ]) page.onSiteInfo(info);
  assert.equal(c.clock.timers.size, 0);
  c.clock.advance(1000); await flush();
  assert.equal(calls, 1);
});

test('publication bursts and reconnect notifications coalesce into one delayed refresh', async () => {
  let calls = 0;
  const c = setup(undefined, async () => [xid(++calls)]);
  const page = new c.StatsPage();
  page.enter(); await flush();
  page.onSiteInfo({ event: ['file_done', 'data/users/person.epix/data.json'] });
  const timer = page.recentRefreshTimer;
  page.onSiteInfo({ event: ['file_done', 'data/users/person.epix/content.json'] });
  page.onSiteInfo({ event: ['updated'] });
  page.onReconnect();
  assert.equal(c.clock.timers.size, 1);
  assert.equal(page.recentRefreshTimer, timer);
  c.clock.advance(250); await flush();
  assert.equal(calls, 2);
  assert.equal(page.recentXids[0].name, 'person-2');
  page.onReconnect();
  assert.equal(c.clock.timers.size, 1);
  c.clock.advance(250); await flush();
  assert.equal(calls, 3);
});

test('events arriving during a directory request queue exactly one follow-up refresh', async () => {
  const pending = deferred();
  let calls = 0;
  const c = setup(undefined, () => ++calls === 1 ? pending.promise : Promise.resolve([xid(calls)]));
  const page = new c.StatsPage();
  page.enter();
  page.onSiteInfo({ event: ['file_done', 'data/users/person.epix/data.json'] });
  page.onSiteInfo({ event: ['updated'] });
  page.onReconnect();
  assert.equal(page.recentRefreshQueued, true);
  assert.equal(c.clock.timers.size, 0);
  assert.equal(calls, 1);
  pending.resolve([xid(1)]); await flush();
  assert.equal(page.recentRefreshQueued, false);
  assert.equal(c.clock.timers.size, 1);
  c.clock.advance(250); await flush();
  assert.equal(calls, 2);
  assert.equal(page.recentXids[0].name, 'person-2');
  assert.equal(c.clock.timers.size, 0);
});

test('a failed automatic refresh keeps the snapshot and processes a queued update', async () => {
  const pending = deferred();
  let calls = 0;
  const c = setup(undefined, () => ++calls === 2 ? pending.promise : Promise.resolve([xid(calls)]));
  const page = new c.StatsPage();
  page.enter(); await flush();
  const previous = page.recentXids, refreshedAt = page.recentRefreshedAt;
  page.onSiteInfo({ event: ['updated'] });
  c.clock.advance(250);
  page.onSiteInfo({ event: ['updated'] });
  pending.reject(new Error('directory unavailable')); await flush();
  assert.equal(page.recentXids, previous);
  assert.equal(page.recentRefreshedAt, refreshedAt);
  assert.match(page.recentError, /last successful list/);
  assert.equal(c.clock.timers.size, 1);
  c.clock.advance(250); await flush();
  assert.equal(calls, 3);
  assert.equal(page.recentXids[0].name, 'person-3');
  assert.equal(page.recentError, '');
});

test('leaving cancels delayed refreshes and ignores updates until the page is entered again', async () => {
  let calls = 0;
  const c = setup(undefined, async () => [xid(++calls)]);
  const page = new c.StatsPage();
  page.enter(); await flush();
  page.onReconnect();
  assert.equal(c.clock.timers.size, 1);
  page.leave();
  assert.equal(page.active, false);
  assert.equal(page.recentRefreshTimer, null);
  assert.equal(c.clock.timers.size, 0);
  page.onSiteInfo({ event: ['updated'] });
  page.onReconnect();
  c.clock.advance(1000); await flush();
  assert.equal(calls, 1);
  page.enter(); await flush();
  assert.equal(page.active, true);
  assert.equal(calls, 2);
});

test('leaving during a directory request drops its queued automatic refresh', async () => {
  const pending = deferred();
  let calls = 0;
  const c = setup(undefined, () => { calls++; return pending.promise; });
  const page = new c.StatsPage();
  page.enter();
  page.onSiteInfo({ event: ['updated'] });
  assert.equal(page.recentRefreshQueued, true);
  page.leave();
  assert.equal(page.recentRefreshQueued, false);
  pending.resolve([xid(1)]); await flush();
  assert.equal(c.clock.timers.size, 0);
  c.clock.advance(1000); await flush();
  assert.equal(calls, 1);
});

test('re-entering during an old request schedules a fresh query after it completes', async () => {
  const pending = deferred();
  let calls = 0;
  const c = setup(undefined, () => ++calls === 1 ? pending.promise : Promise.resolve([xid(calls)]));
  const page = new c.StatsPage();
  page.enter();
  page.leave();
  page.enter();
  assert.equal(calls, 1);
  assert.equal(page.recentRefreshQueued, true);
  pending.resolve([xid(1)]); await flush();
  assert.equal(c.clock.timers.size, 1);
  c.clock.advance(250); await flush();
  assert.equal(calls, 2);
  assert.equal(page.recentXids[0].name, 'person-2');
});

test('manual refresh consumes a pending automatic refresh without duplicating requests', async () => {
  let calls = 0;
  const c = setup(undefined, async () => [xid(++calls)]);
  const page = new c.StatsPage();
  page.enter(); await flush();
  page.onReconnect();
  assert.equal(c.clock.timers.size, 1);
  page.handleRefresh(); await flush();
  assert.equal(calls, 2);
  assert.equal(c.clock.timers.size, 0);
  c.clock.advance(1000); await flush();
  assert.equal(calls, 2);
});

test('standalone mode never schedules directory refreshes for updates or reconnects', async () => {
  let calls = 0;
  const c = setup(undefined, async () => { calls++; return []; }, false);
  const page = new c.StatsPage();
  page.enter(); await flush();
  page.onSiteInfo({ event: ['file_done', 'data/users/person.epix/data.json'] });
  page.onSiteInfo({ event: ['updated'] });
  page.onReconnect();
  assert.equal(c.clock.timers.size, 0);
  assert.equal(page.recentRefreshQueued, false);
  c.clock.advance(1000); await flush();
  assert.equal(calls, 0);
});
