import { readFileSync } from "node:fs";
import { listSourceFiles } from "./server.js";
import type { Wrapper, WrapperCandidate } from "./types.js";

const EXPORT_DECLARATION_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Z]\w*)/g;
const EXPORT_LIST_PATTERN = /export\s*\{([^}]*)\}/g;
const BARE_IMPORT_PATTERN = /from\s+["']([^."'][^"']*)["']/g;
const SUBJECT_PATTERN = /^`?(\w+)`?/;
const PROVIDER_NAME_PATTERN =
  /(?:within|inside|outside of|outside|from)\s+(?:an?\s+|the\s+)?[<`]?([A-Z]\w*)/;

/**
 * Where each name a project exports is declared, for finding the provider a component
 * needs from its error.
 */
export const buildExportIndex = (appDirectory: string): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  const add = (name: string, file: string): void => {
    index.set(name, [...(index.get(name) ?? []), file]);
  };
  for (const file of listSourceFiles(appDirectory)) {
    const text = readFileSync(file, "utf8");
    for (const [, name = ""] of text.matchAll(EXPORT_DECLARATION_PATTERN)) add(name, file);
    for (const [, names = ""] of text.matchAll(EXPORT_LIST_PATTERN))
      for (const specifier of names.split(",")) {
        const exported = specifier
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (exported && /^[A-Z]/.test(exported)) add(exported, file);
      }
  }
  return index;
};

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
  const name = PROVIDER_NAME_PATTERN.exec(error)?.[1];
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
