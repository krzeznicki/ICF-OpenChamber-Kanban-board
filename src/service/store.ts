// The service's own JSON files under ~/.icf-kanban (links.json, queue.json): atomic writes, one
// writer at a time per file, and a corrupt file set aside instead of silently overwritten.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const code = (e: unknown): string | undefined => (e as { code?: unknown } | null)?.code as string | undefined;

/**
 * The parsed file, or null when it does not exist. A file that is not JSON is renamed to
 * `<file>.corrupt-<timestamp>` (kept for the user to inspect) and read as missing. Any other
 * read error (permissions, a folder in the way) throws: only a missing file means "empty".
 */
export const readJson = async (file: string, now: () => number = Date.now): Promise<unknown> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if (code(e) === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      await rename(file, `${file}.corrupt-${now()}`);
    } catch (e) {
      // Another reader set it aside first.
      if (code(e) !== 'ENOENT') throw e;
    }
    return null;
  }
};

export const writeJson = async (file: string, data: unknown): Promise<void> => {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
};

const chains = new Map<string, Promise<unknown>>();

/** Runs `fn` after every earlier `serial` call on the same file: read-modify-write never loses an update. */
export const serial = <T>(file: string, fn: () => Promise<T>): Promise<T> => {
  const run = (chains.get(file) ?? Promise.resolve()).then(fn);
  const tail = run.catch(() => {});
  chains.set(file, tail);
  void tail.then(() => {
    if (chains.get(file) === tail) chains.delete(file);
  });
  return run;
};
