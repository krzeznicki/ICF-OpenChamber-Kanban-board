// Which build this is: the production extension ("prod", id icf-kanban) or the local test build
// ("test", id icf-kanban-test, made by `npm run build:test`). esbuild bakes the value in with
// `define: { __KANBAN_VARIANT__: '"prod"' | '"test"' }`; unbundled code (tests, tsc) has no
// such global and runs as prod. The test build keeps its data, branches and skills apart.
// No node: imports: the panel bundle reads VARIANT too.
export type Variant = 'prod' | 'test';

declare const __KANBAN_VARIANT__: string | undefined;

/** Only "test" selects the test build; anything else is production. */
export const toVariant = (value: string | undefined): Variant => (value === 'test' ? 'test' : 'prod');

export const VARIANT: Variant = toVariant(typeof __KANBAN_VARIANT__ === 'undefined' ? undefined : __KANBAN_VARIANT__);

/** Name of the service's data folder in the home directory (links.json, queue.json). */
export const dataDirName = (variant: Variant): string => (variant === 'test' ? '.icf-kanban-test' : '.icf-kanban');

/** Prefix of the branch a worktree start creates: icf/<slug> or icf-test/<slug>. */
export const branchPrefix = (variant: Variant): string => (variant === 'test' ? 'icf-test/' : 'icf/');

/** The panel id (manifest contributes.panel.id), also the providerId of the session items it starts. */
export const panelId = (variant: Variant): string => (variant === 'test' ? 'icf-kanban-test' : 'icf-kanban');
