// Draws markdown.ts's safe tree with createElement and textContent (never innerHTML). A link click
// goes to `onLink` (host.openUrl: the sandboxed page cannot navigate); checkboxes are read-only.
import { MD_TAGS, parseMarkdown, type MdNode } from '../markdown.ts';

const build = (nodes: MdNode[], into: Node, onLink: (url: string) => void): void => {
  for (const n of nodes) {
    if (n.kind === 'text') {
      into.appendChild(document.createTextNode(n.text));
      continue;
    }
    const node = document.createElement(MD_TAGS.has(n.tag) ? n.tag : 'span');
    if (n.tag === 'a' && n.href !== undefined) {
      const href = n.href;
      const a = node as HTMLAnchorElement;
      a.href = href;
      a.title = href;
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        onLink(href);
      });
    }
    if (n.tag === 'ol' && n.start !== undefined) (node as HTMLOListElement).start = n.start;
    if (n.tag === 'input') {
      const box = node as HTMLInputElement;
      box.type = 'checkbox';
      box.checked = n.checked === true;
      box.disabled = true;
      box.className = 'kb-md-check';
    }
    build(n.children, node, onLink);
    into.appendChild(node);
  }
};

/** A `.kb-md` block with the rendered body. */
export const renderMarkdown = (src: string, onLink: (url: string) => void): HTMLElement => {
  const box = document.createElement('div');
  box.className = 'kb-md';
  build(parseMarkdown(src), box, onLink);
  return box;
};
