import type { CoverageSummary, Mutation, MutationSurvivor } from "./report.js";

// The slice of Stryker's mutation-testing-elements JSON report we read: each
// file maps to mutants carrying a status and a 1-based start line. We narrow to
// what we need and tolerate anything else, so a schema we don't fully model
// degrades to "no survivors found" rather than throwing.
interface StrykerMutant {
  status?: string;
  mutatorName?: string;
  location?: { start?: { line?: number } };
}
interface StrykerReport {
  files?: Record<string, { mutants?: StrykerMutant[] }>;
}

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Pull the *survived* mutants out of a Stryker report. "Survived" means the
 * mutant ran and the suite still passed, i.e. nothing caught it — the proven
 * assertion gap. "NoCoverage" is excluded: that's a coverage gap the branch
 * worklist already names, not an assertion gap. Defensive: a malformed report
 * yields `[]`.
 */
export const parseStrykerSurvivors = (report: unknown): MutationSurvivor[] => {
  const files = (report as StrykerReport | null)?.files;
  if (!files || typeof files !== "object") return [];
  const survivors: MutationSurvivor[] = [];
  for (const [file, entry] of Object.entries(files)) {
    // `mutants` may be missing, null, or — from a partial/errored report — a
    // non-array value. `?? []` only handles null/undefined, so guard the type
    // explicitly: a malformed entry yields no survivors rather than throwing.
    const mutants = Array.isArray(entry?.mutants) ? entry.mutants : [];
    for (const mutant of mutants) {
      const line = mutant?.location?.start?.line;
      if (mutant?.status === "Survived" && typeof line === "number") {
        survivors.push({ file, line, mutator: mutant.mutatorName });
      }
    }
  }
  return survivors;
};

/**
 * Match survived mutants back to the manifest, so a *predicted* mutant becomes a
 * *proven* gap. A target matches a survivor when they share a file (by basename,
 * since the report's paths and ours can be rooted differently) and line. Returns
 * the matched manifest targets, deepest-first, which a caller can surface at the
 * very top of the worklist: the branch runs, but no assertion noticed the flip.
 */
export const matchSurvivors = (
  summary: CoverageSummary,
  survivors: ReadonlyArray<MutationSurvivor>,
): Mutation[] => {
  const targets = summary.depth?.mutations ?? [];
  if (targets.length === 0 || survivors.length === 0) return [];
  // Guard the survivor shape: a hand-built or partial list may carry entries
  // that aren't `{ file: string, line: number }`. Skip those rather than throw.
  const survivorKeys = new Set(
    survivors
      .filter(
        (survivor) => typeof survivor?.file === "string" && typeof survivor?.line === "number",
      )
      .map((survivor) => `${basename(survivor.file)}:${survivor.line}`),
  );
  return targets
    .filter((target) => target.file && survivorKeys.has(`${basename(target.file)}:${target.line}`))
    .sort((left, right) => right.depth - left.depth || left.line - right.line);
};
