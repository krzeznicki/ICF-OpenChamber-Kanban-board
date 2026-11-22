// A move shows at once: the panel draws the moved card's new state before the write and the reload
// from its source (which for GitHub takes a few `gh` calls) finish. Each write adds its states and
// settles them once its reload is done; a reload landing in between (poll, another write) is drawn
// with the pending states over it, so the card never snaps back and forth. A failed write settles
// too, and the reload then shows the state the source really has. Pure: runs under node:test.
import type { Task, TaskState } from '../core/types.ts';

export type PendingStates = ReadonlyMap<string, TaskState>;

export const createPending = () => {
  let next = 0;
  /** Writes in flight, oldest first: a later write of the same card wins. */
  const writes = new Map<number, PendingStates>();
  return {
    /** States a write is about to save; returns the key to settle it with. */
    add: (states: PendingStates): number => {
      const key = next++;
      writes.set(key, new Map(states));
      return key;
    },
    /** The write and its reload are done (or it failed): its states are no longer drawn over the list. */
    settle: (key: number): void => {
      writes.delete(key);
    },
    /** The listed tasks with every pending state drawn over them (the same list when none). */
    apply: (tasks: readonly Task[]): Task[] => {
      if (writes.size === 0) return tasks as Task[];
      const states = new Map<string, TaskState>();
      for (const write of writes.values()) for (const [id, state] of write) states.set(id, state);
      return tasks.map((t) => {
        const state = states.get(t.id);
        return state === undefined || state === t.state ? t : { ...t, state };
      });
    },
  };
};

/** What closing `task` sets: it goes done, and its open sub-tasks too when they close with it. */
export const closingStates = (task: Task, tasks: readonly Task[], withChildren: boolean): PendingStates => {
  const states = new Map<string, TaskState>([[task.id, 'done']]);
  if (withChildren) for (const t of tasks) if (t.parentId === task.id && t.state !== 'done') states.set(t.id, 'done');
  return states;
};
