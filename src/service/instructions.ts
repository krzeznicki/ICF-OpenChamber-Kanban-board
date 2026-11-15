// The paragraph every agent session reads (contributes.instructions): where the task-board CLI is
// and its key commands. Set once when the service starts; it stays on the OpenChamber server.
import { VARIANT, type Variant } from '../core/variant.ts';

/** The part of the service host this needs; `createServiceHost(...)` satisfies it. */
export type InstructionsHost = { setInstructions(directory: string | null, text: string): Promise<unknown> };

/** One short paragraph: it costs tokens in every session. The test build says so and names its own skills. */
export const instructionsText = (cliPath: string, variant: Variant = VARIANT): string => {
  const tb = `node ${JSON.stringify(cliPath)}`;
  const test = variant === 'test';
  const intro = test
    ? 'Kanban TEST development build (a local test copy of the ICF-kanban board, separate from the production Kanban Board): use it only when the user asks for the TEST board. '
    : '';
  const skills = test ? 'kanban-test-create/status/next/start' : 'icf-kanban-create/status/next/start';
  return (
    intro +
    `Task board (ICF-kanban${test ? ' TEST' : ''}): in projects with docs/agents/issue-tracker.md, tasks are managed with \`${tb}\`; ` +
    'always pass --dir <the project root, i.e. the main checkout, not a worktree>. ' +
    '`list --ready` or `next` for ready tickets, `show <id>`, `claim <id>` (claim applies to sub-tasks you take from `list --ready`/`next`; skip lines marked claimed), ' +
    '`state <id> <state>` (done closes), `create --title <t> [--type bug|enhancement] [--parent <id>]`; ' +
    `--json for data. Skills ${skills} describe the steps. ` +
    `The ICF-kanban ${test ? 'TEST board' : 'board'} in OpenChamber shows the same tasks.`
  );
};

/** Publishes the paragraph for every directory. Never throws: a failure is logged and the service keeps running. */
export const publishInstructions = async (
  host: InstructionsHost,
  cliPath: string,
  log: (line: string) => void = console.error,
): Promise<boolean> => {
  log('icf-kanban: setting agent instructions');
  try {
    await host.setInstructions(null, instructionsText(cliPath));
    return true;
  } catch (e) {
    log(`icf-kanban: setInstructions failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
};
