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
.kb-card-error { color: var(--oc-error-text, var(--oc-fg)); font-size: 0.8em; overflow-wrap: anywhere; }
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
.kb-card { cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.kb-card:focus-visible { outline: 2px solid var(--oc-focus); outline-offset: 1px; }
.kb-card.is-dragging { opacity: 0.4; }
.kb-card.is-busy { opacity: 0.6; cursor: progress; }
.kb-ghost { position: fixed; left: 0; top: 0; z-index: 60; pointer-events: none; margin: 0; cursor: grabbing;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); }
:root.kb-dragging, :root.kb-dragging * { cursor: grabbing !important; }
.kb-column.is-drop-target { border-color: var(--oc-primary); box-shadow: inset 0 0 0 1px var(--oc-primary); }
.kb-add-error:empty { display: none; }
.kb-fields { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.kb-field { flex: 1 1 10rem; min-width: 0; }
.kb-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.5rem; }
.kb-actions-start { justify-content: flex-start; }
.kb-actions-label { color: var(--oc-muted); font-size: 0.85em; }
.kb-backdrop { position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / 0.35); display: flex; justify-content: flex-end; }
.kb-sheet { width: min(36rem, 100%); height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem;
  padding: 1rem; background: var(--oc-bg); color: var(--oc-fg); border-left: 1px solid var(--oc-border); outline: none; }
.kb-sheet-head { display: flex; align-items: flex-start; gap: 0.5rem; }
.kb-icon-close { font-size: 1.25em; line-height: 1; padding-inline: 0.5rem; }
.kb-sheet-titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.kb-sheet-title { margin: 0; font-size: 1.1em; font-weight: 600; overflow-wrap: anywhere; }
.kb-inline-spin { display: inline-flex; align-items: center; }
.kb-meta { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 0; font-size: 0.85em; }
.kb-meta dt { color: var(--oc-muted); }
.kb-meta dd { margin: 0; font-family: var(--oc-mono); overflow-wrap: anywhere; }
.kb-card-summary { margin: 0; font-size: 0.85em; color: var(--oc-muted); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.kb-summary { display: flex; flex-direction: column; gap: 0.5rem; }
.kb-summary-text { margin: 0; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.kb-summary-note { margin: 0; color: var(--oc-muted); font-size: 0.85em; display: flex; align-items: center; gap: 0.5rem; }
.kb-muted { margin: 0; color: var(--oc-muted); font-size: 0.85em; }
.kb-modal-backdrop { justify-content: center; align-items: flex-start; padding: 2rem 1rem; overflow-y: auto; }
.kb-modal { width: min(900px, 100%); max-height: calc(100vh - 4rem); overflow-y: auto; display: flex; flex-direction: column;
  gap: 0.25rem; padding: 0 1.25rem 1.25rem; background: var(--oc-bg); color: var(--oc-fg); border: 1px solid var(--oc-border);
  border-radius: var(--oc-radius); box-shadow: 0 16px 48px rgb(0 0 0 / 0.3); outline: none; }
:root[data-oc-surface="panel"] .kb-modal-backdrop { padding: 0; }
:root[data-oc-surface="panel"] .kb-modal { width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; padding: 0 0.75rem 0.75rem; }
.kb-modal-head { position: sticky; top: 0; z-index: 1; background: var(--oc-bg); display: flex; flex-direction: column; gap: 0.5rem;
  padding: 1rem 0 0.75rem; border-bottom: 1px solid var(--oc-border); }
.kb-modal-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.kb-modal-session { display: flex; align-items: center; gap: 0.5rem; }
.kb-modal-session:empty { display: none; }
.kb-section { border-bottom: 1px solid var(--oc-border); }
.kb-section[hidden] { display: none; }
.kb-section-head { cursor: pointer; font-weight: 600; font-size: 0.95em; padding: 0.75rem 0; user-select: none; }
.kb-section-head:focus-visible { outline: 2px solid var(--oc-focus); outline-offset: 2px; }
.kb-section-body { display: flex; flex-direction: column; gap: 0.75rem; padding-bottom: 1rem; }
.kb-md { line-height: 1.55; overflow-wrap: anywhere; }
.kb-md > :first-child { margin-top: 0; }
.kb-md > :last-child { margin-bottom: 0; }
.kb-md h1, .kb-md h2, .kb-md h3, .kb-md h4, .kb-md h5, .kb-md h6 { margin: 1.1em 0 0.4em; line-height: 1.3; }
.kb-md h1 { font-size: 1.35em; } .kb-md h2 { font-size: 1.2em; } .kb-md h3 { font-size: 1.05em; }
.kb-md h4, .kb-md h5, .kb-md h6 { font-size: 1em; }
.kb-md p, .kb-md ul, .kb-md ol, .kb-md blockquote, .kb-md pre, .kb-md table { margin: 0 0 0.75em; }
.kb-md ul, .kb-md ol { padding-left: 1.5em; }
.kb-md li > ul, .kb-md li > ol { margin: 0.25em 0; }
.kb-md li:has(> .kb-md-check) { list-style: none; margin-left: -1.3em; }
.kb-md-check { margin: 0 0.4em 0 0; vertical-align: -0.1em; }
.kb-md a { color: var(--oc-primary); text-decoration: underline; cursor: pointer; }
.kb-md code { font-family: var(--oc-mono); font-size: 0.88em; background: var(--oc-muted-surface); border-radius: 4px; padding: 0.1em 0.3em; }
.kb-md pre { padding: 0.75rem; overflow-x: auto; background: var(--oc-muted-surface); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-md pre code { background: none; padding: 0; white-space: pre; }
.kb-md blockquote { padding-left: 0.75rem; border-left: 3px solid var(--oc-border); color: var(--oc-muted); }
.kb-md hr { border: 0; border-top: 1px solid var(--oc-border); margin: 1em 0; }
.kb-md table { border-collapse: collapse; display: block; overflow-x: auto; }
.kb-md th, .kb-md td { border: 1px solid var(--oc-border); padding: 0.3em 0.6em; text-align: left; }
.kb-confirm-backdrop { z-index: 70; justify-content: center; align-items: center; padding: 1rem; }
.kb-confirm { width: min(26rem, 100%); display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem;
  background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-confirm-title { margin: 0; font-size: 1em; font-weight: 600; overflow-wrap: anywhere; }
.kb-confirm-body { margin: 0; color: var(--oc-muted); font-size: 0.9em; }
.kb-sheet-part { display: flex; flex-direction: column; gap: 0.75rem; }
.kb-sheet-part:empty, .kb-sheet-part[hidden] { display: none; }
.kb-start { padding: 0.75rem; border: 1px solid var(--oc-border); border-radius: var(--oc-radius); background: var(--oc-muted-surface); }
.kb-settings-tabs { display: flex; }
.kb-settings-body { display: flex; flex-direction: column; gap: 1rem; }
.kb-settings-section { display: flex; flex-direction: column; gap: 0.5rem; }
.kb-settings-heading { margin: 0; font-size: 0.95em; font-weight: 600; }
.kb-settings-hint { margin: 0; color: var(--oc-muted); font-size: 0.85em; }
.kb-inherit { display: flex; flex-direction: column; gap: 0.125rem; }
.kb-inherit-reset { display: flex; justify-content: flex-end; }
.kb-preset { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem;
  border: 1px solid var(--oc-border); border-radius: var(--oc-radius); background: var(--oc-muted-surface); }
.kb-preset-head { display: flex; align-items: flex-end; gap: 0.5rem; }
.kb-preset-head > :first-child { flex: 1 1 auto; min-width: 0; }
.kb-add-modal { width: min(44rem, 100%); }
.kb-add-form { display: flex; flex-direction: column; gap: 0.75rem; padding-top: 0.75rem; }
.kb-add-group { gap: 0.5rem; }
.kb-add-checks { display: flex; flex-direction: column; gap: 0.25rem; max-height: 14rem; overflow-y: auto;
  padding: 0.25rem 0.5rem; border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-add-check[hidden] { display: none; }
.kb-add-sub-row { display: flex; align-items: flex-end; gap: 0.5rem; }
.kb-add-sub-row > .kb-field { flex: 1 1 auto; }
.kb-add-sub-row .kb-add-sub-type { flex: 0 1 11rem; }
.kb-add-sub-row .kb-add-sub-title { flex: 1 1 14rem; }
.kb-add-sub { padding-top: 0.25rem; }
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
