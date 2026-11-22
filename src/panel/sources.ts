// Several sources on one board (ADR 0001): each task is handled the way its own source works
// (task.source), not the way the primary source does. Pure, so it runs under node:test.
import { isSourceId, type SourceId } from '../core/types.ts';

/** `source` (a draft's chosen source, '' for none) when it is a source, else `fallback` (the primary source). */
export const sourceOr = (source: string, fallback: SourceId): SourceId => (isSourceId(source) ? source : fallback);
