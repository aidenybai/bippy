import { readFileSync } from "node:fs";
import type { Wrapper, WrapperCandidate } from "./types.js";

const PACKAGE_IMPORT_PATTERN = /import\s+([^;]*?)\s*from\s+["']([^."'][^"']*)["']/g;
const NAMED_IMPORTS_PATTERN = /\{([^}]*)\}/;
const NAMESPACE_NAME_PATTERN = /^(?:type\s+)?([A-Z]\w*)/;
const SUBJECT_PATTERN = /^`?(\w+)`?/;
const PROVIDER_NAME_PATTERNS = [
  /(?:within|inside|outside of|outside|from|descendant of|placed in)\s+(?:an?\s+|the\s+)?[<`]{0,2}([A-Z]\w*(?:\.[A-Z]\w*)?)/,
  /([A-Z]\w*Provider) was not found/,
  /<([A-Z]\w*(?:\.[A-Z]\w*)?)> is missing/,
  /wrapped in a <([A-Z]\w*)/,
];

/**
 * The component an error is about, like `Tooltip` in "`Tooltip` must be used within
 * `TooltipProvider`". When that is one of the wrappers, the new parent goes around it.
 */
export const getErrorSubject = (error: string): string | null =>
  SUBJECT_PATTERN.exec(error)?.[1] ?? null;

const getSharedPrefixLength = (left: string, right: string): number => {
  let length = 0;
  while (length < left.length && left[length] === right[length]) length++;
  return length;
};

interface PackageImport {
  specifier: string;
  namespace: string | null;
}

/**
 * The packages a file imports, and the namespaces of parts it imports from them by name,
 * like `DropdownMenu` in `import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"`.
 */
const getPackageImports = (file: string): PackageImport[] => {
  const packageImports = new Map<string, PackageImport>();
  for (const [, clause = "", specifier = ""] of readFileSync(file, "utf8").matchAll(
    PACKAGE_IMPORT_PATTERN,
  )) {
    packageImports.set(specifier, { specifier, namespace: null });
    for (const namedImport of NAMED_IMPORTS_PATTERN.exec(clause)?.[1]?.split(",") ?? []) {
      const namespace = NAMESPACE_NAME_PATTERN.exec(namedImport.trim())?.[1];
      if (namespace) packageImports.set(`${specifier}#${namespace}`, { specifier, namespace });
    }
  }
  return [...packageImports.values()];
};

/**
 * The parent a component says it needs when it throws without one, like `Menu` in
 * "`MenuItem` must be used within `Menu`", and where it might come from: a project export
 * of that name, nearest first, or the packages the component imports and the namespaces
 * of parts it imports from them, whose `Root` stands in when the name is internal to the
 * package.
 */
export const findWrapper = (
  error: string,
  componentFile: string,
  exportIndex: Map<string, string[]>,
): Wrapper | null => {
  const name = PROVIDER_NAME_PATTERNS.map((pattern) => pattern.exec(error)?.[1]).find(Boolean);
  if (!name) return null;
  const projectFiles = [...(exportIndex.get(name) ?? [])].sort(
    (left, right) =>
      getSharedPrefixLength(right, componentFile) - getSharedPrefixLength(left, componentFile),
  );
  const projectCandidates = projectFiles.map((file): WrapperCandidate => ({
    specifier: file,
    namespace: null,
    importer: componentFile,
    exportName: name,
    isRootAllowed: false,
  }));
  const packageCandidates = getPackageImports(componentFile).map(
    ({ specifier, namespace }): WrapperCandidate => ({
      specifier,
      namespace,
      importer: componentFile,
      exportName: name,
      isRootAllowed: true,
    }),
  );
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
            namespace: null,
            importer: componentFile,
            exportName: name,
            isRootAllowed: false,
          },
        ],
      }
    : null;
};
