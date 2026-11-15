// Board styles. Colours, font and radius come from the host theme: applyHostReady writes the
// --oc-* variables on <html> on every ready snapshot, so a theme switch repaints without remounting.
// It also sets data-oc-surface, which stacks the columns in the narrow rail panel.
const CSS = `
html, body { margin: 0; padding: 0; background: var(--oc-bg); color: var(--oc-fg); font-family: var(--oc-font); }
* { box-sizing: border-box; }
.kb { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem; min-height: 100vh; }
.kb-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.kb-project { flex: 1 1 12rem; min-width: 10rem; max-width: 22rem; }
.kb-spacer { flex: 1 1 auto; }
.kb-status:empty { display: none; }
.kb-columns { display: flex; gap: 0.75rem; align-items: flex-start; overflow-x: auto; padding-bottom: 0.25rem; }
.kb-column { flex: 1 0 15rem; min-width: 15rem; display: flex; flex-direction: column; gap: 0.5rem;
  background: var(--oc-muted-surface); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); padding: 0.5rem; }
.kb-column-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  font-weight: 600; font-size: 0.9em; padding: 0.125rem 0.25rem; }
.kb-count { color: var(--oc-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.kb-cards { display: flex; flex-direction: column; gap: 0.5rem; }
.kb-none { color: var(--oc-muted); font-size: 0.85em; padding: 0.25rem; }
.kb-card { background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border);
  border-radius: var(--oc-radius); padding: 0.5rem 0.625rem; display: flex; flex-direction: column; gap: 0.375rem; }
.kb-card.is-child { margin-left: 0.75rem; }
.kb-card-title { font-weight: 500; overflow-wrap: anywhere; }
.kb-card-id { color: var(--oc-muted); font-family: var(--oc-mono); font-size: 0.8em; overflow-wrap: anywhere; }
.kb-badges { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.kb-badges:empty { display: none; }
.kb-progress { display: flex; flex-direction: column; gap: 0.25rem; }
.kb-progress-label { color: var(--oc-muted); font-size: 0.8em; font-variant-numeric: tabular-nums; }
.kb-wizard { display: flex; flex-direction: column; gap: 0.75rem; max-width: 34rem; margin: 1rem auto; padding: 1rem;
  background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-wizard-title { margin: 0; font-size: 1.1em; font-weight: 600; }
.kb-wizard-body { margin: 0; color: var(--oc-muted); font-size: 0.9em; }
.kb-wizard-actions { display: flex; justify-content: flex-end; }
.kb-loading { display: flex; justify-content: center; padding: 2rem 0; }
:root[data-oc-surface="panel"] .kb-columns { flex-direction: column; align-items: stretch; overflow-x: visible; }
:root[data-oc-surface="panel"] .kb-column { flex: 0 0 auto; min-width: 0; }
`;

let injected = false;

export const injectStyles = (): void => {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
};
