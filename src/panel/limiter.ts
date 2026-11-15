// What summaries (summaries.ts) and type/state suggestions (suggest.ts) share around host.generate:
// a small concurrency limit, so the Small Model never gets more than `n` requests from this panel at
// once (a freed slot goes straight to the next waiter, in order), and whether the Small Model is
// available at all, so either finding it missing switches both off with one notice. Pure, so it
// runs under node:test.

export type Limiter = { run: <T>(fn: () => Promise<T>) => Promise<T> };

/** Generations running at once from one panel; the rest wait their turn. */
export const GENERATE_CONCURRENCY = 2;

export const createLimiter = (n: number = GENERATE_CONCURRENCY): Limiter => {
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;
      try {
        return await fn();
      } finally {
        const next = waiting.shift();
        if (next !== undefined) next();
        else active--;
      }
    },
  };
};

/** The one notice when the Small Model turns out missing (NO_MODEL) or not granted (NOT_GRANTED). */
export const MODEL_NOTICES = {
  NO_MODEL:
    'No Small Model is set, so automatic summaries are off and new tasks stay needs-triage with no type for now. Choose a Small Model in OpenChamber settings, then press Summarise in a task.',
  NOT_GRANTED:
    'Summaries and type/state suggestions need the “model” permission for Kanban Board (Settings → Extensions). Automatic summaries are off and new tasks stay needs-triage with no type for now.',
} as const;

export type ModelAvailability = {
  /** False once a request found the model missing or not granted, until a model answers again. */
  available: () => boolean;
  /** A request failed with NO_MODEL or NOT_GRANTED; the first time this panel session, `onUnavailable` is called. */
  unavailable: (code: string) => void;
  /** A model answered. */
  answered: () => void;
};

export const createModelAvailability = (onUnavailable?: (code: string) => void): ModelAvailability => {
  let down = false;
  let noticed = false;
  return {
    available: () => !down,
    unavailable: (code) => {
      down = true;
      if (noticed) return;
      noticed = true;
      onUnavailable?.(code);
    },
    answered: () => {
      down = false;
    },
  };
};
