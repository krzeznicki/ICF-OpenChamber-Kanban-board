// The start queue: cards dropped on In Progress over the per-project limit wait here, in order.
// Pure and shared: the panel and the service both decide with nextToStart. The queue itself is
// kept by the service in ~/.icf-kanban/queue.json, so it drains while the board is closed.

/** One waiting start: everything the service needs to start it by itself (path B). */
export type QueueEntry = {
  taskId: string;
  title: string;
  /** The first message, built by the panel when the card was queued. */
  prompt: string;
  model: string | null;
  agent: string | null;
  /** The thinking level (OpenCode variant); absent in entries queued before 0.3. */
  variant?: string | null;
  location: 'worktree' | 'project';
  queuedAt: number;
  /** Why the service's last start of this entry failed; it was put back at the front. */
  lastError?: string;
  /** How many starts of this entry by the service failed in a row; at MAX_START_FAILURES it is no longer taken automatically. */
  failures?: number;
};

/** After this many failed starts by the service, an entry waits for the user (drag it out, or queue it again). */
export const MAX_START_FAILURES = 3;

/**
 * Live state of a session the service knows about through its links. `unknown`: the host does not
 * know the session (deleted) or it was not asked; `error`: asking failed (no grant, host unreachable,
 * rate limit), so the running count cannot be trusted.
 */
export type LinkStatus = 'idle' | 'busy' | 'waiting' | 'unknown' | 'error';

/** The queued task ids (oldest first) that may start now, given how many sessions run. */
export const nextToStart = (queued: string[], running: number, maxParallel: number): string[] =>
  queued.slice(0, Math.max(0, maxParallel - running));
