import { readFileSync } from "node:fs";
import type { Wrapper, WrapperCandidate } from "./types.js";

const PACKAGE_IMPORT_PATTERN = /import\s+([^;]*?)\s*from\s+["']([^."'][^"']*)["']/g;
const NAMED_IMPORTS_PATTERN = /\{([^}]*)\}/;
const NAMESPACE_NAME_PATTERN = /^(?:type\s+)?([A-Z]\w*)/;
const SUBJECT_PATTERN = /^`?(\w+)`?/;
/** A context's provider is the context itself to mount, as `X.Provider` isn't an export. */
const CONTEXT_PROVIDER_SUFFIX = /\.Provider$/;
const CONTEXT_SUFFIX = /Context$/;
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
  const namedParent = PROVIDER_NAME_PATTERNS.map((pattern) => pattern.exec(error)?.[1])
    .find(Boolean)
    ?.replace(CONTEXT_PROVIDER_SUFFIX, "");
  if (!namedParent) return null;
  // A context an error names may not be exported, but its provider, like `UsersProvider`
  // for `UsersContext`, usually is.
  const providerName = namedParent.replace(CONTEXT_SUFFIX, "Provider");
  const name =
    !exportIndex.has(namedParent) && exportIndex.has(providerName) ? providerName : namedParent;
  const projectFiles = [...(exportIndex.get(name) ?? [])].sort(
    (left, right) =>
      getSharedPrefixLength(right, componentFile) - getSharedPrefixLength(left, componentFile),
  );
  const projectCandidates = projectFiles.map((file): WrapperCandidate => ({
    specifier: file,
    namespace: null,
    props: {},
    importer: componentFile,
    exportName: name,
    isRootAllowed: false,
  }));
  const packageCandidates = getPackageImports(componentFile).map(
    ({ specifier, namespace }): WrapperCandidate => ({
      specifier,
      namespace,
      props: {},
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
const getCompoundRootName = (
  componentName: string,
  componentFile: string,
  exportIndex: Map<string, string[]>,
): string | undefined =>
  [...exportIndex]
    .filter(
      ([candidate, files]) =>
        candidate !== componentName &&
        componentName.startsWith(candidate) &&
        files.includes(componentFile),
    )
    .map(([candidate]) => candidate)
    .sort((left, right) => right.length - left.length)[0];

const createFileWrapper = (
  name: string,
  componentFile: string,
  exportNames: string[],
): Wrapper => ({
  name,
  candidates: exportNames.map((exportName) => ({
    specifier: componentFile,
    namespace: null,
    props: {},
    importer: componentFile,
    exportName,
    isRootAllowed: false,
  })),
});

export const findCompoundRoot = (
  componentName: string,
  componentFile: string,
  exportIndex: Map<string, string[]>,
): Wrapper | null => {
  const name = getCompoundRootName(componentName, componentFile, exportIndex);
  return name ? createFileWrapper(name, componentFile, [name]) : null;
};

/**
 * The other parts of the compound component a component belongs to, like `TabsList` for
 * `TabsTrigger`, one of which may be the parent it needs inside the root: Radix's tab
 * triggers throw for want of the `RovingFocusGroup` only the list renders.
 */
export const findSiblingParts = (
  componentName: string,
  componentFile: string,
  exportIndex: Map<string, string[]>,
): Wrapper | null => {
  const rootName = getCompoundRootName(componentName, componentFile, exportIndex);
  if (!rootName) return null;
  const siblings = [...exportIndex]
    .filter(
      ([candidate, files]) =>
        candidate !== rootName &&
        candidate !== componentName &&
        candidate.startsWith(rootName) &&
        files.includes(componentFile),
    )
    .map(([candidate]) => candidate);
  return siblings.length > 0
    ? createFileWrapper(`${rootName} part`, componentFile, siblings)
    : null;
};

/**
 * The provider of a context the component reads, for an error that names no parent, like
 * "Cannot destructure property 'board' of 'useBoard(...)' as it is null" from a hook that
 * reads a context with no provider above. The driver gives it a sample of the value.
 */
export const findContextProvider = (
  contextKeys: string[],
  componentFile: string,
  exportIndex: Map<string, string[]>,
  isWrapped: (name: string) => boolean,
): Wrapper | null => {
  for (const contextKey of contextKeys) {
    const separatorIndex = contextKey.lastIndexOf("#");
    const file = contextKey.slice(0, separatorIndex);
    const name = contextKey.slice(separatorIndex + 1);
    if (isWrapped(name) || !exportIndex.get(name)?.includes(file)) continue;
    return {
      name,
      candidates: [
        {
          specifier: file,
          namespace: null,
          props: {},
          importer: componentFile,
          exportName: name,
          isRootAllowed: false,
        },
      ],
    };
  }
  return null;
};
