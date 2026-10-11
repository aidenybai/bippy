import { readFileSync } from "node:fs";
import type { Wrapper, WrapperCandidate } from "./types.js";

const BARE_IMPORT_PATTERN = /from\s+["']([^."'][^"']*)["']/g;
const SUBJECT_PATTERN = /^`?(\w+)`?/;
const PROVIDER_NAME_PATTERNS = [
  /(?:within|inside|outside of|outside|from|descendant of)\s+(?:an?\s+|the\s+)?[<`]{0,2}([A-Z]\w*)/,
  /([A-Z]\w*Provider) was not found/,
];

/**
 * The component an error is about, like `Tooltip` in "`Tooltip` must be used within
 * `TooltipProvider`". When that is one of the wrappers, the new parent goes around it.
 */
export const getErrorSubject = (error: string): string | null =>
  SUBJECT_PATTERN.exec(error)?.[1] ?? null;

/**
 * The parent a component says it needs when it throws without one, like `Menu` in
 * "`MenuItem` must be used within `Menu`", and where it might come from: a project export
 * of that name, or the packages the component imports, whose `Root` stands in when the
 * name is internal to the package.
 */
export const findWrapper = (
  error: string,
  componentFile: string,
  exportIndex: Map<string, string[]>,
): Wrapper | null => {
  const name = PROVIDER_NAME_PATTERNS.map((pattern) => pattern.exec(error)?.[1]).find(Boolean);
  if (!name) return null;
  const projectCandidates = (exportIndex.get(name) ?? []).map((file): WrapperCandidate => ({
    specifier: file,
    importer: componentFile,
    exportName: name,
    isRootAllowed: false,
  }));
  const packageCandidates = [
    ...new Set(
      [...readFileSync(componentFile, "utf8").matchAll(BARE_IMPORT_PATTERN)].map(
        ([, specifier = ""]) => specifier,
      ),
    ),
  ].map((specifier): WrapperCandidate => ({
    specifier,
    importer: componentFile,
    exportName: name,
    isRootAllowed: true,
  }));
  const candidates = [...projectCandidates, ...packageCandidates];
  return candidates.length > 0 ? { name, candidates } : null;
};

/**
 * The root of the compound component a component belongs to: the longest name its own file
 * exports that starts its name, like `AlertDialog` for `AlertDialogContent`. It stands in when
 * an error names a parent the component already has, as Radix's `AlertDialog` parts throw
 * for want of a `Dialog`.
 */
export const findCompoundRoot = (
  exportName: string,
  componentFile: string,
  exportIndex: Map<string, string[]>,
): Wrapper | null => {
  const [name] = [...exportIndex]
    .filter(
      ([candidate, files]) =>
        candidate !== exportName &&
        exportName.startsWith(candidate) &&
        files.includes(componentFile),
    )
    .map(([candidate]) => candidate)
    .sort((left, right) => right.length - left.length);
  return name
    ? {
        name,
        candidates: [
          {
            specifier: componentFile,
            importer: componentFile,
            exportName: name,
            isRootAllowed: false,
          },
        ],
      }
    : null;
};
