import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MD_TAGS, parseMarkdown, safeUrl, type MdNode } from '../src/panel/markdown.ts';

const walk = (nodes: MdNode[], out: MdNode[] = []): MdNode[] => {
  for (const n of nodes) {
    out.push(n);
    if (n.kind === 'el') walk(n.children, out);
  }
  return out;
};
const els = (src: string) => walk(parseMarkdown(src)).filter((n) => n.kind === 'el');
const tags = (src: string): string[] => els(src).map((n) => (n.kind === 'el' ? n.tag : ''));
const text = (nodes: MdNode[]): string => nodes.map((n) => (n.kind === 'text' ? n.text : text(n.children))).join('');
const links = (src: string) => els(src).flatMap((n) => (n.kind === 'el' && n.tag === 'a' ? [{ href: n.href, text: text(n.children) }] : []));

/** Every node is text or an allowed tag, and every href is http(s). */
const assertSafe = (src: string): void => {
  for (const n of walk(parseMarkdown(src))) {
    if (n.kind === 'text') continue;
    assert.ok(MD_TAGS.has(n.tag), `tag ${n.tag}`);
    if (n.href !== undefined) assert.match(n.href, /^https?:\/\//);
  }
};

test('safeUrl: only http and https', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('http://example.com'), 'http://example.com/');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,<b>', 'vbscript:x', 'mailto:a@b.c', '/relative', '#anchor', 'file:///etc/passwd', '']) {
    assert.equal(safeUrl(bad), null, bad);
  }
});

test('markdown: raw HTML in a body comes out as text, never as an element', () => {
  const src = 'Hi <img src=x onerror=alert(1)> there\n\n<script>alert(1)</script>\n\n<div onclick="x()">block</div>';
  assert.deepEqual(tags(src), ['p', 'p', 'p']);
  const all = text(parseMarkdown(src));
  assert.ok(all.includes('<img src=x onerror=alert(1)>'));
  assert.ok(all.includes('<script>alert(1)</script>'));
  assertSafe(src);
});

test('markdown: javascript:, data: and relative links are plain text', () => {
  const src = '[click](javascript:alert(1)) [d](data:text/html,<script>x</script>) [r](/x) [h](#top) <javascript:alert(1)>';
  assert.deepEqual(links(src), []);
  assert.ok(text(parseMarkdown(src)).includes('[click](javascript:alert(1))'));
  assertSafe(src);
});

test('markdown: http(s) links and bare http(s) URLs become links; e-mail addresses stay text', () => {
  const src = '[docs](https://example.com/docs) see http://a.test/x, mail me@example.com';
  assert.deepEqual(links(src), [
    { href: 'https://example.com/docs', text: 'docs' },
    { href: 'http://a.test/x', text: 'http://a.test/x' },
  ]);
  assertSafe(src);
});

test('markdown: file names and bare host names are not linkified (.md is a top-level domain)', () => {
  assert.deepEqual(links('see spec.md, docs/agents/issue-tracker.md, main.ts and www.example.org'), []);
});

test('markdown: images never load; a safe one is a link labelled with its alt text', () => {
  assert.deepEqual(links('![diagram](https://example.com/d.png)'), [{ href: 'https://example.com/d.png', text: 'diagram' }]);
  assert.ok(!tags('![x](https://example.com/d.png)').includes('img'));
  assert.deepEqual(links('![x](javascript:alert(1))'), []);
  assertSafe('![x](javascript:alert(1)) ![y](https://e.com/a.png)');
});

test('markdown: task-list items get read-only checkboxes', () => {
  const nodes = parseMarkdown('- [ ] todo\n- [x] done\n- plain');
  const items = walk(nodes).filter((n) => n.kind === 'el' && n.tag === 'li');
  const boxes = items.map((li) => (li.kind === 'el' ? li.children.find((c) => c.kind === 'el' && c.tag === 'input') : undefined));
  assert.equal(boxes.length, 3);
  assert.equal(boxes[0]?.kind === 'el' && boxes[0].checked, false);
  assert.equal(boxes[1]?.kind === 'el' && boxes[1].checked, true);
  assert.equal(boxes[2], undefined);
  assert.equal(text(items.slice(0, 2).map((li) => li)).trim(), 'tododone');
});

test('markdown: structure (headings, lists, code, quotes, tables, emphasis)', () => {
  const src = '# T\n\n## Sub\n\n1. a\n2. b\n\n> q\n\n```ts\n<b>x</b>\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n**bold** _em_ ~~s~~ `c<i>`\n\n---';
  assert.deepEqual(tags(src), [
    'h1', 'h2', 'ol', 'li', 'li', 'blockquote', 'p', 'pre', 'code',
    'table', 'thead', 'tr', 'th', 'th', 'tbody', 'tr', 'td', 'td',
    'p', 'strong', 'em', 's', 'code', 'hr',
  ]);
  const code = els(src).find((n) => n.kind === 'el' && n.tag === 'pre');
  assert.equal(code?.kind === 'el' ? text(code.children) : '', '<b>x</b>\n');
  assertSafe(src);
});

test('markdown: an ordered list keeps its start number', () => {
  const ol = els('3. c\n4. d').find((n) => n.kind === 'el' && n.tag === 'ol');
  assert.equal(ol?.kind === 'el' ? ol.start : undefined, 3);
});
