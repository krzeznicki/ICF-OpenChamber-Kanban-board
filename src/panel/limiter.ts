// A small concurrency limit for host.generate: summaries (summaries.ts) and type/state suggestions
// (suggest.ts) share one, so the Small Model never gets more than `n` requests from this panel at
// once. A freed slot goes straight to the next waiter, in order. Pure, so it runs under node:test.

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
