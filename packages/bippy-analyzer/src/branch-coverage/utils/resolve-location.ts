import type { LineIndex, OffsetMapper } from "../cfg-shared.js";

/**
 * Resolve a served-script byte offset to a source location: the source map's
 * file + line when it resolves, the served-script line as a fallback, and line 0
 * when there's no offset at all.
 */
export const resolveLocation = (
  mapOffset: OffsetMapper | null,
  lineIndex: LineIndex,
  offset: number | null,
): { file?: string; line: number } => {
  if (offset === null) return { line: 0 };
  const location = mapOffset?.(offset) ?? null;
  return { file: location?.file, line: location?.line ?? lineIndex.lineOf(offset) };
};
