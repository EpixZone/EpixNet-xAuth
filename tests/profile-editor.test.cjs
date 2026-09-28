const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { h } = require('../js/lib/maquette.js');

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function nodes(value) {
  if (!value || typeof value !== 'object') return [];
  return [value].concat((value.children || []).flatMap(nodes));
}
function text(value) { return nodes(value).map(node => node.text || '').join(''); }
function element(value, id) { return nodes(value).find(node => node.properties?.id === id); }
function button(value, label) { return nodes(value).find(node => node.vnodeSelector?.startsWith('button') && text(node) === label); }

function setup() {
  const writes = [];
  const c = {
    h, URL, TextEncoder, setTimeout, clearTimeout,
    Page: { render() {}, handleLinkClick() {}, auth_address: null },
    Chain: { DEFAULT_TLD: 'epix', explorerTxUrl: () => '', evmTxUrl: () => '' },
    Wallet: { address: OWNER },
    Rest: { dns: async () => ({ ok: true, data: { records: [] } }) },
    TxErrors: { extract: error => error.message || String(error) },
    XidContract: {
      ZERO: '0x0000000000000000000000000000000000000000',
      DNS_RECORD_TYPES: [], peersFrom: () => [],
      read: async fn => fn === 'resolve' ? OWNER : fn === 'getProfile' ? ['', ''] : fn === 'getContentRoot' ? ['', 0n] : ['', ''],
      write(fn, args, onStatus) {
        const pending = deferred();
        onStatus('pending');
        writes.push({ fn, args, complete() { onStatus('success'); pending.resolve({ status: 1 }); }, reject: pending.reject });
        return pending.promise;
      }
    }
  };
  c.window = c;
  vm.createContext(c);
  for (const file of ['lib/marked.min.js', 'utils/Text.js', 'utils/Bech32.js', 'utils/Format.js', 'utils/ProfileMarkdown.js', 'utils/ProfileEditor.js', 'wallet/TxState.js', 'pages/NameDetailPage.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), c, { filename: file });
  }
  const page = new c.NameDetailPage();
  page.name = 'alice'; page.tld = 'epix'; page.owner = OWNER;
  page.profileLoading = false;
  page.avatar = 'https://example.com/avatar.png';
  page.bio = 'A plain biography.';
  return { c, page, profile: page.profile, writes };
}

function input(profile, value, start = value.length, end = start) {
  // Model maquette's afterCreate/afterUpdate before the next user event.
  profile.handleBioNode({ focus() {}, setSelectionRange() {} });
  profile.handleBioInput({ target: { value, selectionStart: start, selectionEnd: end } });
}
function format(profile, kind) {
  profile.handleFormat({ currentTarget: { getAttribute: name => name === 'data-format' ? kind : null } });
}

// These tests exercise the actual editor and transaction state machine. The
// contract boundary is replaced with deferred promises; nothing is signed.
test('editing is gated on loaded profile data and current ownership', () => {
  const { c, page, profile } = setup();
  page.profileLoading = true;
  profile.handleEdit(); assert.equal(profile.editing, false);
  assert.equal(button(profile.render(), 'Edit').properties.disabled, true);
  page.profileLoading = false; page.profileError = 'Could not load profile';
  profile.handleEdit(); assert.equal(profile.editing, false);
  assert.equal(button(profile.render(), 'Edit').properties.disabled, true);
  page.profileError = ''; c.Wallet.address = OTHER;
  profile.handleEdit(); assert.equal(profile.editing, false);
  assert.equal(button(profile.render(), 'Edit'), undefined);
  c.Wallet.address = OWNER;
  profile.handleEdit(); assert.equal(profile.editing, true);
});

test('waiting for profile data avoids editing empty fields over an existing profile', async () => {
  const { c, page, profile } = setup();
  const pending = deferred(); c.XidContract.read = () => pending.promise;
  page.avatar = page.bio = '';
  page.loadProfile(); profile.handleEdit(); assert.equal(profile.editing, false);
  pending.resolve(['https://example.com/existing.png', '**Existing biography**']); await flush();
  profile.handleEdit();
  assert.equal(profile.editAvatar, 'https://example.com/existing.png');
  assert.equal(profile.editBio, '**Existing biography**');
});

test('opening, previewing, and cancelling preserve existing source and avatar', () => {
  const { page, profile, writes } = setup();
  page.bio = '  Text with **Markdown**\n\nand a trailing line.\n';
  profile.handleEdit();
  const source = profile.editBio, avatar = profile.editAvatar;
  profile.handlePreview();
  assert.ok(nodes(profile.render()).some(node => node.vnodeSelector === 'strong'));
  profile.handleWrite();
  assert.equal(profile.editBio, source); assert.equal(profile.editAvatar, avatar);
  input(profile, 'discard this draft'); profile.handleCancel();
  assert.equal(page.bio, source); assert.equal(page.avatar, avatar); assert.equal(writes.length, 0);
});

test('save submits Markdown source and preserves the avatar, then refreshes after success', async () => {
  const { page, profile, writes } = setup();
  let refreshed = 0; page.loadProfile = () => { refreshed++; };
  profile.handleEdit();
  const source = '### Hello\n\n**Writer** and [reader](https://example.com).';
  input(profile, source); profile.handlePreview(); profile.handleSave();
  assert.equal(writes.length, 1); assert.equal(writes[0].fn, 'updateProfile');
  assert.deepEqual(Array.from(writes[0].args), ['alice', 'epix', page.avatar, source]);
  assert.equal(profile.editing, true); assert.equal(refreshed, 0);
  writes[0].complete(); await flush();
  assert.equal(profile.editing, false); assert.equal(refreshed, 1);
});

test('empty fields can be intentionally saved and clear the previous profile', () => {
  const { profile, writes } = setup(); profile.handleEdit();
  input(profile, ''); profile.handleAvatarInput({ target: { value: '' } }); profile.handleSave();
  assert.equal(writes.length, 1);
  assert.deepEqual(Array.from(writes[0].args).slice(2), ['', '']);
});

test('UTF-8 bio limits allow exactly 512 bytes and block 513 without truncating', () => {
  for (const exact of ['a'.repeat(512), '🙂'.repeat(128), 'é'.repeat(256), 'e\u0301'.repeat(170) + 'aa']) {
    const { profile, writes } = setup(); profile.handleEdit(); input(profile, exact);
    assert.equal(profile.bioBytes(), 512);
    assert.equal(profile.validationMessage(), '');
    profile.handleSave(); assert.equal(writes.length, 1);
    const second = setup(); second.profile.handleEdit(); input(second.profile, exact + 'a');
    assert.equal(second.profile.bioBytes(), 513);
    assert.match(second.profile.validationMessage(), /512 bytes/);
    assert.equal(second.profile.editBio, exact + 'a');
    assert.equal(element(second.profile.render(), 'profile-bio').properties['aria-invalid'], 'true');
    second.profile.handleSave(); assert.equal(second.writes.length, 0);
  }
});

test('avatar limits count UTF-8 bytes and block oversized saves', () => {
  const { profile, writes } = setup(); profile.handleEdit();
  profile.handleAvatarInput({ target: { value: 'é'.repeat(128) } });
  assert.equal(profile.validationMessage(), '');
  profile.handleAvatarInput({ target: { value: 'é'.repeat(128) + 'a' } });
  assert.match(profile.validationMessage(), /256 bytes/);
  profile.handleSave(); assert.equal(writes.length, 0);
  assert.equal(button(profile.render(), 'Save Profile').properties.disabled, true);
});

test('toolbar edits selected text, preserves surrounding text, and restores the selection', () => {
  const { profile, writes } = setup(); profile.handleEdit();
  input(profile, 'Say hello world', 4, 9); format(profile, 'bold');
  assert.equal(profile.editBio, 'Say **hello** world');
  let focused = 0, selected;
  profile.handleBioNode({ focus() { focused++; }, setSelectionRange(start, end) { selected = [start, end]; } });
  assert.equal(focused, 1); assert.deepEqual(selected, [6, 11]);
  format(profile, 'bold'); assert.equal(profile.editBio, 'Say hello world');
  assert.equal(writes.length, 0);
});

test('stale selection events cannot replace a toolbar edit selection before the next render', () => {
  const { profile } = setup(); profile.handleEdit();
  input(profile, 'hello world', 0, 5); format(profile, 'bold');
  profile.handleBioSelection({ target: { selectionStart: 13, selectionEnd: 13 } });
  assert.equal(profile.editBio.slice(profile.selection.start, profile.selection.end), 'hello');
  profile.handleBioNode({ focus() {}, setSelectionRange() {} });
  profile.handleBioSelection({ target: { selectionStart: 8, selectionEnd: 13 } });
  assert.equal(profile.selection.start, 8); assert.equal(profile.selection.end, 13);
});

test('formatting at a caret creates selected placeholder text without replacing neighbors', () => {
  const { profile } = setup(); profile.handleEdit();
  input(profile, 'left right', 5); format(profile, 'italic');
  assert.equal(profile.editBio, 'left *italic text*right');
  assert.equal(profile.editBio.slice(profile.selection.start, profile.selection.end), 'italic text');
});

test('list and quote toolbar actions affect selected lines but not the next line', () => {
  const { profile } = setup(); profile.handleEdit();
  input(profile, 'first\nsecond\nthird', 0, 13); format(profile, 'list');
  assert.equal(profile.editBio, '- first\n- second\nthird');
  format(profile, 'list'); assert.equal(profile.editBio, 'first\nsecond\nthird');
  input(profile, 'first\nsecond\nthird', 6, 12); format(profile, 'quote');
  assert.equal(profile.editBio, 'first\n> second\nthird');
  input(profile, 'first\nsecond\nthird', 6, 12); format(profile, 'heading');
  assert.equal(profile.editBio, 'first\n# second\nthird');
});

test('code formatting safely handles embedded backticks and multiple lines', () => {
  const { c, profile } = setup(); profile.handleEdit();
  const source = 'const value = `hello`;\n```';
  input(profile, source, 0, source.length); format(profile, 'code');
  const rendered = c.ProfileMarkdown.render(profile.editBio, 'code-test');
  const code = nodes(rendered).find(node => node.vnodeSelector === 'code');
  assert.ok(code);
  assert.equal(text(code).trimEnd(), source);
});

test('Ctrl and Meta keyboard shortcuts format selection, while Alt and composition are ignored', () => {
  const { profile } = setup(); profile.handleEdit();
  let prevented = 0;
  const event = overrides => ({ target: { selectionStart: 0, selectionEnd: 5 }, key: 'b', ctrlKey: true, metaKey: false, altKey: false, isComposing: false, preventDefault() { prevented++; }, ...overrides });
  input(profile, 'hello world', 0, 5); profile.handleBioKey(event());
  assert.equal(profile.editBio, '**hello** world');
  input(profile, 'hello world', 0, 5); profile.handleBioKey(event({ key: 'I', ctrlKey: false, metaKey: true }));
  assert.equal(profile.editBio, '*hello* world');
  input(profile, 'hello world', 0, 5); profile.handleBioKey(event({ altKey: true }));
  profile.handleBioKey(event({ isComposing: true }));
  assert.equal(profile.editBio, 'hello world'); assert.equal(prevented, 2);
  profile.handleBioKey(event({ key: 'k' })); assert.equal(profile.linkOpen, true);
});

test('unsafe links stay out of the draft and expose a disabled insertion action', () => {
  const { profile } = setup(); profile.handleEdit(); input(profile, 'my link', 3, 7);
  profile.handleLinkToggle();
  for (const href of ['javascript:alert(1)', 'data:text/html,hello', '//external.example', '/\n/external.example']) {
    profile.handleLinkUrlInput({ target: { value: href } }); profile.handleInsertLink();
    assert.equal(profile.editBio, 'my link'); assert.equal(profile.linkOpen, true);
    assert.equal(button(profile.render(), 'Insert link').properties.disabled, true);
    assert.equal(element(profile.render(), 'profile-link-url').properties['aria-invalid'], 'true');
  }
});

test('inserted links retain brackets in labels and encode unbalanced target parentheses', () => {
  const { c, profile } = setup(); profile.handleEdit();
  input(profile, 'Visit [my page] today', 6, 15);
  profile.handleLinkToggle();
  profile.handleLinkUrlInput({ target: { value: 'https://example.com/path)tail' } });
  profile.handleInsertLink();
  assert.equal(profile.linkOpen, false);
  const rendered = c.ProfileMarkdown.render(profile.editBio, 'link-test');
  const link = nodes(rendered).find(node => node.vnodeSelector === 'a');
  assert.ok(link); assert.equal(link.properties.href, 'https://example.com/path%29tail');
  assert.equal(text(link), '[my page]');
  assert.match(text(rendered), /Visit/); assert.match(text(rendered), /today/);
});

test('link form receives keyboard focus, Enter inserts, and Escape cancels without changing source', () => {
  const { profile } = setup(); profile.handleEdit(); input(profile, 'my page', 0, 7);
  profile.handleLinkToggle();
  let focused = 0, prevented = 0;
  profile.handleLinkNode({ focus() { focused++; } });
  profile.handleLinkUrlInput({ target: { value: 'https://example.com' } });
  profile.handleLinkKey({ key: 'Enter', preventDefault() { prevented++; } });
  assert.equal(focused, 1); assert.equal(prevented, 1);
  assert.equal(profile.linkOpen, false);
  const source = profile.editBio;
  assert.match(source, /^\[my page\]\(https:\/\/example.com\/\)$/);
  profile.handleLinkToggle();
  profile.handleLinkUrlInput({ target: { value: 'https://another.example' } });
  profile.handleLinkKey({ key: 'Escape', preventDefault() { prevented++; } });
  assert.equal(profile.linkOpen, false); assert.equal(profile.editBio, source); assert.equal(prevented, 2);
});

test('pending saves lock draft mutation and cannot be submitted twice', () => {
  const { profile, writes } = setup(); profile.handleEdit(); input(profile, 'draft', 0, 5);
  const avatar = profile.editAvatar;
  profile.handleSave(); profile.handleSave();
  input(profile, 'changed'); format(profile, 'bold'); profile.handleAvatarInput({ target: { value: 'changed' } }); profile.handleCancel();
  assert.equal(writes.length, 1); assert.equal(profile.editBio, 'draft'); assert.equal(profile.editAvatar, avatar);
  assert.equal(profile.editing, true);
  const tree = profile.render();
  assert.equal(element(tree, 'profile-bio').properties.disabled, true);
  assert.equal(element(tree, 'profile-avatar').properties.disabled, true);
  assert.equal(button(tree, 'Cancel').properties.disabled, true);
});

test('a rejected save keeps the source and presents the error for retry', async () => {
  const { profile, writes } = setup(); profile.handleEdit(); input(profile, '**Keep my draft**');
  profile.handleSave(); writes[0].reject(new Error('User rejected request')); await flush();
  assert.equal(profile.editing, true); assert.equal(profile.editBio, '**Keep my draft**');
  assert.match(text(profile.render()), /User rejected request/);
  assert.equal(button(profile.render(), 'Save Profile').properties.disabled, false);
});

test('ownership loss hides the editor and prevents any save', async () => {
  const { c, page, profile, writes } = setup(); profile.handleEdit(); input(profile, 'draft');
  page.owner = OTHER;
  profile.handleSave(); assert.equal(writes.length, 0);
  assert.equal(element(profile.render(), 'profile-bio'), undefined);
  page.owner = OWNER; c.XidContract.read = async () => OTHER;
  page.loadOwner(); await flush();
  assert.equal(profile.editing, false);
});

test('changing wallet invalidates a pending save callback without overwriting a new draft', async () => {
  const { c, page, profile, writes } = setup(); profile.handleEdit(); input(profile, 'old account draft');
  profile.handleSave();
  let refreshes = 0; page.loadProfile = () => { refreshes++; };
  c.Wallet.address = OTHER; page.onWalletChanged();
  assert.equal(profile.editing, false);
  page.owner = OTHER; page.profileLoading = false; page.bio = 'other account source'; profile.handleEdit();
  input(profile, 'new account draft'); writes[0].complete(); await flush();
  assert.equal(profile.editing, true); assert.equal(profile.editBio, 'new account draft'); assert.equal(refreshes, 0);
});

test('switching names invalidates the old save and preserves the new editor', async () => {
  const { page, profile, writes } = setup(); profile.handleEdit(); input(profile, 'alice draft'); profile.handleSave();
  page.enter('epix', 'bob', null); await flush();
  page.profileLoading = false; page.bio = 'bob source'; profile.handleEdit(); input(profile, 'bob draft');
  writes[0].complete(); await flush();
  assert.equal(page.name, 'bob'); assert.equal(profile.editing, true); assert.equal(profile.editBio, 'bob draft');
});
