const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { h } = require('../js/lib/maquette.js');
const marked = require('../js/lib/marked.min.js');

function renderer(parser = marked) {
  const context = { h, marked: parser, URL };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/utils/ProfileMarkdown.js'), 'utf8'), context);
  return context.ProfileMarkdown;
}
function nodes(tree) {
  return tree && typeof tree === 'object' ? [tree].concat((tree.children || []).flatMap(nodes)) : [];
}
function content(tree) {
  return (tree.text || '') + (tree.children || []).map(content).join('');
}
function elements(tree, tag) {
  return nodes(tree).filter(node => node.vnodeSelector.split(/[.#]/)[0] === tag);
}
function assertSafeNodes(tree) {
  const allowed = new Set(['div', 'span', 'p', 'strong', 'em', 'del', 'a', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'br', 'hr']);
  for (const node of nodes(tree)) {
    assert.ok(allowed.has(node.vnodeSelector.split(/[.#]/)[0]), node.vnodeSelector);
    for (const property of Object.keys(node.properties || {})) {
      assert.ok(!/^on/i.test(property), 'No event handlers: ' + property);
      assert.notEqual(property, 'innerHTML');
      assert.notEqual(property, 'src');
      assert.notEqual(property, 'srcdoc');
      assert.notEqual(property, 'style');
    }
  }
}

test('profile Markdown formats emphasis and scopes headings below the page title', () => {
  const tree = renderer().render('# One\n\n## Two\n\n### Three\n\n#### Four\n\n###### Six\n\n**bold** *italic* ~~strike~~', 'profile-a');
  assert.equal(tree.vnodeSelector, 'div.profile-markdown');
  assert.equal(tree.properties.key, 'profile-a');
  assert.equal(elements(tree, 'h3').length, 1);
  assert.equal(elements(tree, 'h4').length, 1);
  assert.equal(elements(tree, 'h5').length, 1);
  assert.equal(elements(tree, 'h6').length, 2);
  assert.equal(content(elements(tree, 'strong')[0]), 'bold');
  assert.equal(content(elements(tree, 'em')[0]), 'italic');
  assert.equal(content(elements(tree, 'del')[0]), 'strike');
  assertSafeNodes(tree);
});

test('lists, nested lists, ordered starts, blockquotes, and line breaks keep their structure', () => {
  const tree = renderer().render('- first\n  - nested\n\n7. seven\n8. eight\n\n> quoted\n\nline one\nline two\n\n---');
  assert.equal(elements(tree, 'ul').length, 2);
  assert.equal(elements(tree, 'li').length, 4);
  assert.equal(elements(tree, 'ol')[0].properties.start, '7');
  assert.equal(content(elements(tree, 'blockquote')[0]), 'quoted');
  assert.equal(elements(tree, 'br').length, 1);
  assert.equal(elements(tree, 'hr').length, 1);
  assertSafeNodes(tree);
});

test('inline and fenced code retain literal markup and never use a language string as an attribute', () => {
  const tree = renderer().render('`<b>&amp;</b>`\n\n```html" onmouseover="bad\n<script>alert(1)</script>\n```');
  const code = elements(tree, 'code');
  assert.equal(code.length, 2);
  assert.equal(content(code[0]), '<b>&amp;</b>');
  assert.equal(content(code[1]), '<script>alert(1)</script>');
  assert.equal(code[1].vnodeSelector, 'code');
  assertSafeNodes(tree);
});

test('HTML and encoded HTML remain visible text instead of executable elements', () => {
  const source = '<script>alert(1)</script>\n\n<iframe srcdoc="<img src=x onerror=alert(1)>"></iframe>\n\n&lt;svg onload=alert(1)&gt;';
  const tree = renderer().render(source);
  assert.match(content(tree), /<script>alert\(1\)<\/script>/);
  assert.match(content(tree), /<iframe srcdoc=/);
  assert.match(content(tree), /<svg onload=alert\(1\)>/);
  assertSafeNodes(tree);
});

test('image syntax displays alt text without loading images or creating embeds', () => {
  const tree = renderer().render('![**Portrait**](https://tracker.example/image.png) ![<svg onload=bad>](data:image/svg+xml,bad)');
  assert.match(content(tree), /Portrait/);
  assert.match(content(tree), /<svg onload=bad>/);
  assert.equal(elements(tree, 'img').length, 0);
  assert.equal(elements(tree, 'a').length, 0);
  assertSafeNodes(tree);
});

test('safe links use an allowlisted scheme and open without an opener', () => {
  const tree = renderer().render('[Web](https://example.test/page?a=1&amp;b=2 "A title") [Mail](mailto:person@example.test) [Xite](/epix1example/) [Local](./post)');
  const links = elements(tree, 'a');
  assert.equal(links.length, 4);
  assert.equal(links[0].properties.href, 'https://example.test/page?a=1&b=2');
  assert.equal(links[0].properties.title, 'A title');
  assert.equal(links[1].properties.href, 'mailto:person@example.test');
  assert.equal(links[2].properties.href, '/epix1example/');
  assert.equal(links[3].properties.href, './post');
  for (const link of links) {
    assert.equal(link.properties.target, '_blank');
    assert.equal(link.properties.rel, 'noopener noreferrer');
  }
  assertSafeNodes(tree);
});

test('reference links and autolinks use the same safe URL policy', () => {
  const tree = renderer().render('[Site][ref] and <https://example.test/>\n\n[ref]: /epix1example/?page=one "Local xite"');
  const links = elements(tree, 'a');
  assert.equal(links.length, 2);
  assert.equal(links[0].properties.href, '/epix1example/?page=one');
  assert.equal(links[1].properties.href, 'https://example.test/');
});

test('unsafe Markdown links leave their readable labels without clickable destinations', () => {
  const tree = renderer().render('[script](javascript:alert(1)) [encoded](jav&#x61;script:alert(1)) [data](data:text/html,bad) [network](//evil.test/) [file](file:///etc/passwd)');
  assert.equal(elements(tree, 'a').length, 0);
  assert.match(content(tree), /script encoded data network file/);
  assertSafeNodes(tree);
});

test('safeHref blocks scripts, encoded control characters, backslashes, and disguised external paths', () => {
  const { safeHref } = renderer();
  const unsafe = [
    '', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:bad', 'data:text/html,bad', 'blob:https://example.test/id', 'file:///etc/passwd',
    'jav&#x61;script:alert(1)', 'javascript&colon;alert(1)', 'java&Tab;script:alert(1)', 'java\tscript:alert(1)',
    '//evil.test/path', '\\evil.test', '/\\evil.test', 'https:\\evil.test', '/%2fevil.test', '/%252fevil.test', '/%5cevil.test', '/%255cevil.test',
    '/path\nnext', '/&Tab;/evil.test', 'https://example.test/%0a', 'https://example.test/%250a', 'https://example.test/%5c',
    'mailto:person@example.test?subject=hello%0d%0aBcc:other@example.test', '../..//evil.test/path', 'javascript%3aalert(1)'
  ];
  for (const value of unsafe) assert.equal(safeHref(value), null, value);
});

test('safeHref retains explicit relative links and ordinary encoded query values', () => {
  const { safeHref } = renderer();
  for (const value of ['/epix1example/', './post', '../profile', '?page=one', '#section', '/path?discount=25%25', '/path?q=hello%20world']) {
    assert.equal(safeHref(value), value);
  }
  assert.equal(safeHref(' HTTPS://EXAMPLE.TEST/path '), 'https://example.test/path');
  assert.equal(safeHref('mailto:person@example.test'), 'mailto:person@example.test');
});

test('link titles and quote-containing destinations cannot introduce DOM attributes', () => {
  const tree = renderer().render('[label](https://example.test/path "\" onmouseover=alert(1)")');
  assertSafeNodes(tree);
  const direct = renderer({ lexer: () => [{ type: 'paragraph', tokens: [{ type: 'link', href: 'https://example.test/" onmouseover="bad', title: '" onmouseover="bad', tokens: [{ type: 'text', text: 'label' }] }] }] });
  const hostile = direct.render('test');
  assert.equal(elements(hostile, 'a').length, 1);
  assert.equal(elements(hostile, 'a')[0].properties.title, '" onmouseover="bad');
  assertSafeNodes(hostile);
});

test('unknown tokens and unsupported tables are rendered as plain text', () => {
  const table = renderer().render('| A | B |\n| - | - |\n| 1 | 2 |');
  assert.match(content(table), /\| A \| B \|/);
  const unknown = renderer({ lexer: () => [{ type: 'custom', raw: '<object data="javascript:bad">' }] }).render('test');
  assert.match(content(unknown), /<object data=/);
  assertSafeNodes(unknown);
});

test('every sibling vnode has a unique stable key across repeated renders', () => {
  const markdown = renderer();
  const source = '**bold** plain *italic* [link](/epix1one/)\n\n- first\n- second\n\n> quoted';
  const first = markdown.render(source, 'stable-bio');
  const second = markdown.render(source, 'stable-bio');
  assert.deepEqual(nodes(first).map(node => node.properties.key), nodes(second).map(node => node.properties.key));
  for (const node of nodes(first)) {
    assert.equal(typeof node.properties.key, 'string');
    const keys = (node.children || []).map(child => child.properties.key);
    assert.equal(new Set(keys).size, keys.length);
  }
});

test('parser failures fall back to safe visible source, and empty profiles render an empty container', () => {
  const source = '<img src=x onerror=bad>';
  const tree = renderer({ lexer() { throw new Error('Parser failure'); } }).render(source, 'fallback');
  assert.equal(content(tree), source);
  assertSafeNodes(tree);
  const empty = renderer().render('');
  assert.equal(content(empty), '');
  assert.equal(empty.vnodeSelector, 'div.profile-markdown');
});
