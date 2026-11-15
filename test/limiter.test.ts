import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_NOTICES, createLimiter, createModelAvailability } from '../src/panel/limiter.ts';

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const deferred = () => {
  let resolve!: (v: string) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('limiter: at most n run at once; a freed slot goes to the next waiter in order', async () => {
  const limit = createLimiter(2);
  const jobs = [deferred(), deferred(), deferred(), deferred()];
  const started: number[] = [];
  const results = jobs.map((j, i) =>
    limit.run(() => {
      started.push(i);
      return j.promise;
    }),
  );
  const all = Promise.allSettled(results);
  await settle();
  assert.deepEqual(started, [0, 1]);
  jobs[1]!.resolve('b');
  await settle();
  assert.deepEqual(started, [0, 1, 2]);
  jobs[0]!.reject(new Error('x'));
  await settle();
  assert.deepEqual(started, [0, 1, 2, 3], 'a failed job frees its slot too');
  jobs[2]!.resolve('c');
  jobs[3]!.resolve('d');
  const settled = await all;
  assert.deepEqual(
    settled.map((s) => s.status),
    ['rejected', 'fulfilled', 'fulfilled', 'fulfilled'],
  );
  // All slots are free again.
  const again = [deferred(), deferred()];
  const more: number[] = [];
  again.forEach((j, i) => void limit.run(() => (more.push(i), j.promise)));
  await settle();
  assert.deepEqual(more, [0, 1]);
});

test('model availability: unavailable on NO_MODEL / NOT_GRANTED, one notice per session; an answer makes it available again', () => {
  const notices: string[] = [];
  const a = createModelAvailability((code) => notices.push(code));
  assert.equal(a.available(), true);
  a.unavailable('NO_MODEL');
  a.unavailable('NOT_GRANTED');
  assert.equal(a.available(), false);
  assert.deepEqual(notices, ['NO_MODEL']);
  a.answered();
  assert.equal(a.available(), true);
  a.unavailable('NO_MODEL');
  assert.equal(a.available(), false);
  assert.deepEqual(notices, ['NO_MODEL'], 'still one notice per session');
  assert.match(MODEL_NOTICES.NOT_GRANTED, /permission/);
});
