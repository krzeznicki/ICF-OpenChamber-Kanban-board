// Personal task summaries: a few plain sentences at the top of a card, written by the user's
// Small Model (host.generate) and kept in the extension's storage per user, never in the repo.
// The storage key holds a hash of the body, the language and the prompt, so a changed body (an
// edit on GitHub while the board is open, say) has a new key: the old summary is never shown for
// it, and a new one is generated. Pure apart from the injected generate and storage, so it runs
// under node:test.
import type { Task } from '../core/types.ts';
import type { SummarySettings } from './settings.ts';

/** `{language}`, `{title}` and `{body}` are filled in by buildPrompt. */
export const DEFAULT_SUMMARY_PROMPT = `Summarise this task for me in {language}, in 2 to 4 plain sentences: what changes for the user, why it matters, and what "done" means. No headings, no lists, no markdown. Write only the summary.

Title: {title}

{body}`;

/** The SDK's limit on a generate prompt (GUEST_GENERATE_PROMPT_MAX). */
export const PROMPT_MAX = 64_000;
/** Plenty for four sentences; keeps a runaway answer short. */
const MAX_OUTPUT_TOKENS = 400;
/** What is kept of an answer (a storage value may hold 64 KiB). */
const TEXT_MAX = 2_000;
const MAX_KEY = 128;
/** Generations running at once; the rest wait their turn. */
const CONCURRENCY = 2;

/** The system prompt; a request also carries a reference line so a late answer finds its key. */
export const SUMMARY_SYSTEM =
  'You write short, plain summaries of software tasks for the person who will review them. Answer with the summary text only.';
const REF = '[icf-kanban-summary ';

export type GenerateRequest = { prompt: string; system?: string; maxOutputTokens?: number };
export type LateResult = { request: GenerateRequest } & (
  | { ok: true; result: { text: string } }
  | { ok: false; code: string; error: string }
);

export type SummaryStorage = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: never) => Promise<void>;
  delete: (key: string) => Promise<void>;
  /** When present, older summaries of a task are removed once a new one is stored. */
  keys?: () => Promise<string[]>;
};

export type StoredSummary = { text: string; createdAt: number };

export type SummaryStatus = 'ready' | 'pending' | 'failed' | 'unavailable' | 'none';

/** FNV-1a over UTF-16 code units, 32 bit, from a given offset basis. */
const fnv = (s: string, basis: number): string => {
  let h = basis;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/** Two FNV-1a runs with different bases: 16 hex digits, deterministic, no crypto needed. */
const hash = (s: string): string => fnv(s, 0x811c9dc5) + fnv(s, 0x050c5d1f);

/** Every summary key of one task starts with this; a long id is replaced by a hash so the key fits. */
const taskPrefix = (projectId: string, taskId: string): string => {
  const plain = `summary:${projectId}:${taskId}:`;
  return plain.length + 16 <= MAX_KEY ? plain : `summary:~${hash(JSON.stringify([projectId, taskId]))}:`;
};

/** `s.language` is the language in force for this task (the card's own, else the settings'). */
export const summaryKey = (projectId: string, task: Task, s: SummarySettings): string =>
  taskPrefix(projectId, task.id) + hash(JSON.stringify([task.body, s.language, s.prompt]));

const fill = (template: string, values: Record<'language' | 'title' | 'body', string>): string =>
  template.replace(/\{(language|title|body)\}/g, (_, k: 'language' | 'title' | 'body') => values[k]);

/** The prompt sent to the model: placeholders filled, the body cut so the whole stays under the limit. */
export const buildPrompt = (task: Task, s: SummarySettings): string => {
  const template = s.prompt.includes('{body}') ? s.prompt : `${s.prompt}\n\nTitle: {title}\n\n{body}`;
  const values = { language: s.language, title: task.title, body: '' };
  const bodies = template.split('{body}').length - 1;
  const budget = Math.max(0, Math.floor((PROMPT_MAX - fill(template, values).length) / bodies));
  const cut = '\n[…the rest is cut]';
  const body = task.body.length <= budget ? task.body : `${task.body.slice(0, Math.max(0, budget - cut.length))}${cut}`;
  return fill(template, { ...values, body }).slice(0, PROMPT_MAX);
};

const parseStored = (raw: unknown): StoredSummary | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  return typeof r.text === 'string' && r.text.trim() !== '' && typeof r.createdAt === 'number'
    ? { text: r.text, createdAt: r.createdAt }
    : null;
};

const clean = (text: string): string => text.trim().slice(0, TEXT_MAX);

const codeOf = (e: unknown): string | null =>
  typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : null;

/** No usable model, or the model capability is not approved: no use asking again this session. */
const UNAVAILABLE = new Set(['NO_MODEL', 'NOT_GRANTED']);

export type SummariesDeps = {
  generate: (request: GenerateRequest) => Promise<{ text: string }>;
  storage: SummaryStorage;
  /** The shown project and its summary settings; null while none is loaded. */
  context: () => { projectId: string; summary: SummarySettings } | null;
  /** The card's own summary language (card options), if it set one. */
  loadLanguage?: (projectId: string, taskId: string) => Promise<string | undefined>;
  /** A task's summary or status changed: redraw it. */
  onChange?: (taskId: string) => void;
  /** Called once per session when the model is missing (NO_MODEL) or not granted. */
  onUnavailable?: (code: string) => void;
  now?: () => number;
};

export const createSummaries = (deps: SummariesDeps) => {
  const now = deps.now ?? Date.now;
  const changed = (taskId: string): void => deps.onChange?.(taskId);
  /** key -> text, for every summary read or written this session. */
  const texts = new Map<string, string>();
  /** Keys whose storage read found nothing. */
  const missing = new Set<string>();
  const reads = new Map<string, Promise<string | null>>();
  const gens = new Map<string, Promise<string | null>>();
  /** Keys whose generation failed (not for a missing model); no automatic retry. */
  const failed = new Set<string>();
  /** `projectId\0taskId` -> the card's language, once read (undefined: none set). */
  const languages = new Map<string, string | undefined>();
  let unavailable = false;
  let noticed = false;

  // --- at most CONCURRENCY generations; a freed slot goes straight to the next waiter ---
  let active = 0;
  const waiting: Array<() => void> = [];
  const slot = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next !== undefined) next();
      else active--;
    }
  };

  const langKey = (projectId: string, taskId: string): string => `${projectId}\0${taskId}`;

  /** The settings in force for this task, or null when its card language is not known yet. */
  const effective = (task: Task): { projectId: string; summary: SummarySettings } | null => {
    const ctx = deps.context();
    if (ctx === null) return null;
    const k = langKey(ctx.projectId, task.id);
    if (deps.loadLanguage !== undefined && !languages.has(k)) return null;
    const own = languages.get(k);
    return { projectId: ctx.projectId, summary: own === undefined ? ctx.summary : { ...ctx.summary, language: own } };
  };

  const resolve = async (task: Task): Promise<{ key: string; projectId: string; summary: SummarySettings } | null> => {
    const ctx = deps.context();
    if (ctx === null) return null;
    const k = langKey(ctx.projectId, task.id);
    if (deps.loadLanguage !== undefined && !languages.has(k)) {
      let lang: string | undefined;
      try {
        lang = (await deps.loadLanguage(ctx.projectId, task.id))?.trim() || undefined;
      } catch {
        lang = undefined;
      }
      if (!languages.has(k)) languages.set(k, lang);
    }
    const eff = effective(task);
    return eff === null ? null : { key: summaryKey(eff.projectId, task, eff.summary), ...eff };
  };

  const readStored = (key: string, taskId: string): Promise<string | null> => {
    const known = texts.get(key);
    if (known !== undefined) return Promise.resolve(known);
    if (missing.has(key)) return Promise.resolve(null);
    let p = reads.get(key);
    if (p === undefined) {
      p = (async () => {
        try {
          const stored = parseStored(await deps.storage.get(key));
          if (stored !== null) {
            if (!texts.has(key)) {
              texts.set(key, stored.text);
              changed(taskId);
            }
            return texts.get(key) ?? stored.text;
          }
        } catch {
          // An unreadable entry is a miss; generating again overwrites it.
        }
        missing.add(key);
        return texts.get(key) ?? null;
      })().finally(() => reads.delete(key));
      reads.set(key, p);
    }
    return p;
  };

  /** Stores a summary; with `prune`, the task's older summaries go. Failures are ignored. */
  const store = async (key: string, prefix: string | null, text: string): Promise<void> => {
    try {
      await deps.storage.set(key, { text, createdAt: now() } as never);
      if (prefix === null || deps.storage.keys === undefined) return;
      const old = (await deps.storage.keys()).filter((k) => k !== key && k.startsWith(prefix));
      for (const k of old) await deps.storage.delete(k);
    } catch {
      // Shown from memory this session; generated again next time.
    }
  };

  const generate = (task: Task, key: string, projectId: string, s: SummarySettings, force: boolean): Promise<string | null> => {
    const p = slot(async (): Promise<string | null> => {
      // Queued before the model turned out missing: do not ask again.
      if (unavailable && !force) return null;
      const known = texts.get(key);
      if (known !== undefined) return known;
      try {
        const ref = `${REF}${JSON.stringify({ key, task: task.id, project: projectId })}]`;
        const answer = await deps.generate({
          prompt: buildPrompt(task, s),
          system: `${SUMMARY_SYSTEM}\n${ref}`,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });
        const text = clean(answer.text);
        if (text === '') {
          failed.add(key);
          return null;
        }
        failed.delete(key);
        unavailable = false; // a model answered after all
        texts.set(key, text);
        await store(key, taskPrefix(projectId, task.id), text);
        return text;
      } catch (e) {
        const code = codeOf(e);
        if (code !== null && UNAVAILABLE.has(code)) {
          unavailable = true;
          if (!noticed) {
            noticed = true;
            deps.onUnavailable?.(code);
          }
        } else {
          failed.add(key);
        }
        return null;
      }
    }).finally(() => {
      gens.delete(key);
      changed(task.id);
    });
    gens.set(key, p);
    changed(task.id); // now pending
    return p;
  };

  const ensure = async (task: Task, force = false): Promise<string | null> => {
    const r = await resolve(task);
    if (r === null) return null;
    const stored = await readStored(r.key, task.id);
    if (stored !== null) return stored;
    const running = gens.get(r.key);
    if (running !== undefined) return running;
    if (!force && (failed.has(r.key) || unavailable)) return null;
    return generate(task, r.key, r.projectId, r.summary, force);
  };

  const keyNow = (task: Task): string | null => {
    const eff = effective(task);
    return eff === null ? null : summaryKey(eff.projectId, task, eff.summary);
  };

  return {
    /** The summary for the task as it is now (its current body), or null. Never generates. */
    get: (task: Task): string | null => {
      const key = keyNow(task);
      return key === null ? null : (texts.get(key) ?? null);
    },
    status: (task: Task): SummaryStatus => {
      const key = keyNow(task);
      if (key === null) return 'none';
      if (texts.has(key)) return 'ready';
      if (gens.has(key)) return 'pending';
      if (failed.has(key)) return 'failed';
      return unavailable ? 'unavailable' : 'none';
    },
    /** Reads a stored summary (and the card's language); never generates. */
    load: async (task: Task): Promise<string | null> => {
      const r = await resolve(task);
      return r === null ? null : readStored(r.key, task.id);
    },
    /** The stored summary, else a new one; not after a failure for this body or a missing model. */
    ensure: (task: Task): Promise<string | null> => ensure(task),
    /** The Summarise button: tries again even after a failure or a missing model. */
    summarise: (task: Task): Promise<string | null> => {
      const key = keyNow(task);
      if (key !== null) failed.delete(key);
      return ensure(task, true);
    },
    /** Whether summaries are generated on their own: the setting, unless the model is missing. */
    auto: (): boolean => (deps.context()?.summary.auto ?? false) && !unavailable,
    /** The card's language was edited (undefined: back to the settings). */
    setLanguage: (projectId: string, taskId: string, language: string | undefined): void => {
      languages.set(langKey(projectId, taskId), language?.trim() || undefined);
      changed(taskId);
    },
    /** An answer that arrived after the frame that asked was gone. True when it was one of ours. */
    acceptLate: (late: LateResult): boolean => {
      const system = late.request.system ?? '';
      if (!system.startsWith(SUMMARY_SYSTEM)) return false;
      const at = system.lastIndexOf(REF);
      if (at < 0 || !system.endsWith(']')) return false;
      let ref: { key?: unknown; task?: unknown };
      try {
        ref = JSON.parse(system.slice(at + REF.length, -1)) as typeof ref;
      } catch {
        return false;
      }
      if (typeof ref.key !== 'string' || !ref.key.startsWith('summary:') || ref.key.length > MAX_KEY || typeof ref.task !== 'string') {
        return false;
      }
      if (!late.ok) return true; // nothing to keep; the user can press Summarise
      const text = clean(late.result.text);
      if (text === '') return true;
      const key = ref.key;
      const taskId = ref.task;
      texts.set(key, text);
      missing.delete(key);
      failed.delete(key);
      // No pruning: this answer may be for an older body than a summary stored since.
      void store(key, null, text).then(() => changed(taskId));
      changed(taskId);
      return true;
    },
  };
};

export type Summaries = ReturnType<typeof createSummaries>;
