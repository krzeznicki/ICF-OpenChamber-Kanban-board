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
.kb-card { cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.kb-card:focus-visible { outline: 2px solid var(--oc-focus); outline-offset: 1px; }
.kb-card.is-dragging { opacity: 0.4; }
.kb-card.is-busy { opacity: 0.6; cursor: progress; }
.kb-ghost { position: fixed; left: 0; top: 0; z-index: 60; pointer-events: none; margin: 0; cursor: grabbing;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); }
:root.kb-dragging, :root.kb-dragging * { cursor: grabbing !important; }
.kb-column.is-drop-target { border-color: var(--oc-primary); box-shadow: inset 0 0 0 1px var(--oc-primary); }
.kb-add-slot:empty { display: none; }
.kb-add { display: flex; flex-direction: column; gap: 0.5rem; max-width: 40rem; padding: 0.75rem;
  background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
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
.kb-sheet-titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.kb-sheet-title { margin: 0; font-size: 1.1em; font-weight: 600; overflow-wrap: anywhere; }
.kb-inline-spin { display: inline-flex; align-items: center; }
.kb-meta { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 0; font-size: 0.85em; }
.kb-meta dt { color: var(--oc-muted); }
.kb-meta dd { margin: 0; font-family: var(--oc-mono); overflow-wrap: anywhere; }
.kb-detail-body { margin: 0; padding: 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--oc-mono); font-size: 0.85em;
  background: var(--oc-muted-surface); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-detail-body.is-empty { color: var(--oc-muted); font-family: var(--oc-font); }
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
