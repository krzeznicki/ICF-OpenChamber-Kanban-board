// The paragraph every agent session reads (contributes.instructions): where the task-board CLI is
// and its key commands. Set once when the service starts; it stays on the OpenChamber server.

/** The part of the service host this needs; `createServiceHost(...)` satisfies it. */
export type InstructionsHost = { setInstructions(directory: string | null, text: string): Promise<unknown> };

/** One short paragraph: it costs tokens in every session. */
export const instructionsText = (cliPath: string): string => {
  const tb = `node ${JSON.stringify(cliPath)}`;
  return (
    `Task board (ICF-kanban): in projects with docs/agents/issue-tracker.md, tasks are managed with \`${tb}\`; ` +
    'always pass --dir <the project root, i.e. the main checkout, not a worktree>. ' +
    '`list --ready` or `next` for ready tickets, `show <id>`, `claim <id>` (claim applies to sub-tasks you take from `list --ready`/`next`; skip lines marked claimed), ' +
    '`state <id> <state>` (done closes), `create --title <t> [--type bug|enhancement] [--parent <id>]`; ' +
    '--json for data. Skills icf-kanban-create/status/next/start describe the steps. ' +
    'The ICF-kanban board in OpenChamber shows the same tasks.'
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
