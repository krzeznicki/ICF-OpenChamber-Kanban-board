// A task body as formatted markdown, safely. markdown-it parses with `html: false` (raw HTML stays
// text); its tokens become a small tree of allowed tags (MD_TAGS) and text, which ui/markdownView.ts
// turns into DOM with createElement and textContent: no HTML string is ever handed to the browser.
// Links keep only http(s) URLs (others are left as their markdown text), images never load (a safe
// one becomes a link with its alt text), and "- [ ]" / "- [x]" items get read-only checkboxes.
// Pure (no DOM), so it runs under node:test.
import MarkdownIt from 'markdown-it';

type Token = ReturnType<MarkdownIt['parse']>[number];

export const MD_TAGS: ReadonlySet<string> = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'br',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'strong', 'em', 's', 'a', 'input', 'span', 'div',
]);

export type MdNode =
  | { kind: 'text'; text: string }
  | {
      kind: 'el';
      tag: string;
      /** `a` only: an http(s) URL. */
      href?: string;
      /** `ol` only, when it does not start at 1. */
      start?: number;
      /** `input` only: a read-only task-list checkbox. */
      checked?: boolean;
      children: MdNode[];
    };

/** The URL when it is absolute http or https, normalised; anything else is null. */
export const safeUrl = (raw: string): string | null => {
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
// A link to anything but http(s) is not parsed as a link: its markdown stays as text.
md.validateLink = (url: string): boolean => safeUrl(url) !== null;
// Only bare URLs with http(s):// become links. Fuzzy links would turn file names into links (`.md`
// is a top-level domain: spec.md -> http://spec.md/), and e-mail addresses would become mailto:.
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

const el = (tag: string, children: MdNode[] = []): Extract<MdNode, { kind: 'el' }> => ({
  kind: 'el',
  tag: MD_TAGS.has(tag) ? tag : 'span',
  children,
});

const textOf = (tokens: Token[] | null): string => (tokens ?? []).map((t) => (t.children !== null ? textOf(t.children) : t.content)).join('');

/** Inline tokens (a paragraph's or heading's content) into `into`. */
const inline = (tokens: Token[], into: MdNode[]): void => {
  const stack: MdNode[][] = [into];
  const top = (): MdNode[] => stack[stack.length - 1]!;
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
      case 'html_inline': // never produced with html: false; text if it ever is
        top().push({ kind: 'text', text: t.content });
        break;
      case 'softbreak':
        top().push({ kind: 'text', text: '\n' });
        break;
      case 'hardbreak':
        top().push(el('br'));
        break;
      case 'code_inline':
        top().push(el('code', [{ kind: 'text', text: t.content }]));
        break;
      case 'image': {
        const alt = textOf(t.children) || t.content;
        const href = safeUrl(t.attrGet('src') ?? '');
        if (href === null) top().push({ kind: 'text', text: alt });
        else top().push({ ...el('a', [{ kind: 'text', text: alt || href }]), href });
        break;
      }
      case 'link_open': {
        const href = safeUrl(t.attrGet('href') ?? '');
        const node = href === null ? el('span') : { ...el('a'), href };
        top().push(node);
        stack.push(node.children);
        break;
      }
      default:
        if (t.nesting === 1) {
          const node = el(t.tag);
          top().push(node);
          stack.push(node.children);
        } else if (t.nesting === -1) {
          if (stack.length > 1) stack.pop();
        } else if (t.content !== '') {
          top().push({ kind: 'text', text: t.content });
        }
    }
  }
};

const TASK = /^\[([ xX])\][ \t]+/;

/** "- [ ] x" / "- [x] x": the item's first text loses its marker and the item gets a checkbox first. */
const taskItem = (li: Extract<MdNode, { kind: 'el' }>): void => {
  let first = li.children[0];
  if (first?.kind === 'el' && first.tag === 'p') first = first.children[0];
  if (first?.kind !== 'text') return;
  const m = TASK.exec(first.text);
  if (m === null) return;
  first.text = first.text.slice(m[0].length);
  li.children.unshift({ kind: 'el', tag: 'input', checked: m[1] !== ' ', children: [] });
};

export const parseMarkdown = (src: string): MdNode[] => {
  const root: MdNode[] = [];
  const stack: Array<{ children: MdNode[]; node: Extract<MdNode, { kind: 'el' }> | null }> = [{ children: root, node: null }];
  const top = () => stack[stack.length - 1]!;
  for (const t of md.parse(src, {})) {
    // Tight lists hide their paragraphs: the content goes straight into the item.
    if ((t.type === 'paragraph_open' || t.type === 'paragraph_close') && t.hidden) continue;
    if (t.type === 'inline') {
      inline(t.children ?? [], top().children);
      continue;
    }
    if (t.type === 'fence' || t.type === 'code_block') {
      top().children.push(el('pre', [el('code', [{ kind: 'text', text: t.content }])]));
      continue;
    }
    if (t.nesting === 1) {
      const node = el(t.tag);
      if (t.type === 'ordered_list_open') {
        const start = Number(t.attrGet('start') ?? '1');
        if (Number.isInteger(start) && start !== 1) node.start = start;
      }
      top().children.push(node);
      stack.push({ children: node.children, node });
    } else if (t.nesting === -1) {
      const done = stack.length > 1 ? stack.pop() : undefined;
      if (done?.node?.tag === 'li') taskItem(done.node);
    } else if (t.type === 'hr') {
      top().children.push(el('hr'));
    } else if (t.content !== '') {
      // html_block (never with html: false) and anything unexpected: text.
      top().children.push(el('p', [{ kind: 'text', text: t.content }]));
    }
  }
  return root;
};
