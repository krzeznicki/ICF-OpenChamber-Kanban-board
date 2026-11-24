import { errorMessage, type Task, type TaskState } from '../core/types.ts';
import type { Column } from './columns.ts';
import { planMove } from './moves.ts';

export type ActionResult =
  | { kind: 'success'; id: string }
  | { kind: 'failed' | 'pending'; id: string; message: string }
  | { kind: 'cancelled'; id: string };

/** Result-returning move path for the bulk executor; it owns locking and reload. */
export const executeMove = async (
  task: Task, from: Column, to: Column, children: number,
  deps: {
    before(): Promise<boolean>;
    after(): Promise<void>;
    chooseChildren(): Promise<boolean | null>;
    setState(id: string, state: TaskState): Promise<unknown>;
    close(id: string, withChildren: boolean): Promise<unknown>;
    start(): Promise<ActionResult>;
  },
): Promise<ActionResult> => {
  try {
    const move = planMove(task, from, to, children);
    if (move.kind === 'none') return { kind: 'failed', id: task.id, message: move.reason };
    if (move.kind === 'start') return await deps.start();
    let withChildren = false;
    if (move.kind === 'close' && move.askChildren) {
      const answer = await deps.chooseChildren();
      if (answer === null) return { kind: 'cancelled', id: task.id };
      withChildren = answer;
    }
    if (!(await deps.before())) throw new Error('Could not remove the task from the queue');
    if (move.kind === 'close') await deps.close(task.id, withChildren);
    else {
      await deps.setState(task.id, move.state);
      await deps.after();
    }
    return { kind: 'success', id: task.id };
  } catch (e) {
    return { kind: 'failed', id: task.id, message: errorMessage(e) };
  }
};
