import { sep } from "node:path";
import type { ComponentAnalysis } from "../../src/core/types.js";
import { getDefaultProps } from "./props.js";
import { getParentName } from "./reasons.js";
import type { ExportedName, ProjectIndex, Wrapper } from "./types.js";

const SUBJECT_PATTERN = /^`?(\w+)`?/;
const CONTEXT_PROVIDER_SUFFIX = /(?<=Context)\.Provider$/;
const CONTEXT_SUFFIX = /Context$/;
const NAMESPACE_NAME_PATTERN = /^[A-Z]\w*$/;
const NULL_HOOK_PATTERN = /of '(use[A-Z]\w*)\(\.\.\.\)' as it is (?:null|undefined)/;

export interface ParentQuery {
  name: string;
  file: string;
  error: string;
  isNamingParent: boolean;
  analysis: ComponentAnalysis;
  project: ProjectIndex;
}

/** The component an error is about, like `Tooltip` in "`Tooltip` must be used within …". */
export const getErrorSubject = (error: string): string | null =>
  SUBJECT_PATTERN.exec(error)?.[1] ?? null;

const getSharedSegmentCount = (left: string, right: string): number => {
  const leftSegments = left.split(sep);
  const rightSegments = right.split(sep);
  let count = 0;
  while (count < leftSegments.length && leftSegments[count] === rightSegments[count]) count++;
  return count;
};

const createProjectWrapper = (
  name: string,
  { file, exportName }: ExportedName,
  query: ParentQuery,
): Wrapper => {
  const key = `${file}#${name}`;
  const parentAnalysis = query.project.components.get(`${file}#${exportName}`);
  const contextSample =
    query.analysis.contextSamples.get(key) ?? query.project.contextSamples.get(key);
  const props = parentAnalysis
    ? getDefaultProps(parentAnalysis)
    : contextSample
      ? { value: contextSample }
      : {};
  return { name, candidate: { kind: "project", file, exportName, props } };
};

/**
 * The parent an error names, like `Menu` in "`MenuItem` must be used within `Menu`". A
 * context's `XContext.Provider` mounts as the context, or its exported `XProvider`.
 */
export const getNamedParent = (error: string, project: ProjectIndex): string | null => {
  const named = getParentName(error)?.replace(CONTEXT_PROVIDER_SUFFIX, "");
  if (!named) return null;
  const providerName = named.replace(CONTEXT_SUFFIX, "Provider");
  return !project.exports.has(named) && project.exports.has(providerName) ? providerName : named;
};

/**
 * Where a named parent may come from: project exports of that name, nearest first, then
 * the packages the component's file and the files it imports use, and the namespaces of
 * parts imported from them, like `DropdownMenu` from `radix-ui`.
 */
const findNamedParents = (name: string, query: ParentQuery): Wrapper[] => {
  const projectWrappers = [...(query.project.exports.get(name) ?? [])]
    .sort(
      (left, right) =>
        getSharedSegmentCount(right.file, query.file) -
        getSharedSegmentCount(left.file, query.file),
    )
    .map((exported) => createProjectWrapper(name, exported, query));
  const importingFiles = [query.file, ...(query.project.imports.get(query.file)?.files ?? [])];
  const packageWrappers = importingFiles
    .flatMap((file) => query.project.imports.get(file)?.packages ?? [])
    .flatMap(({ specifier, names }) =>
      [null, ...names.filter((importedName) => NAMESPACE_NAME_PATTERN.test(importedName))].map(
        (namespace): Wrapper => ({
          name,
          candidate: {
            kind: "package",
            specifier,
            namespace,
            exportName: name,
            importer: query.file,
            props: {},
          },
        }),
      ),
    );
  return [...projectWrappers, ...packageWrappers];
};

/** Exports of the component's own file that start its name, longest first. */
const getCompoundRootNames = (query: ParentQuery): string[] =>
  [...query.project.exports]
    .filter(
      ([candidate, exported]) =>
        candidate !== query.name &&
        query.name.startsWith(candidate) &&
        exported.some(({ file }) => file === query.file),
    )
    .map(([candidate]) => candidate)
    .sort((left, right) => right.length - left.length);

const findOwnExport = (name: string, query: ParentQuery): Wrapper[] =>
  (query.project.exports.get(name) ?? [])
    .filter(({ file }) => file === query.file)
    .map((exported) => createProjectWrapper(name, exported, query));

/**
 * The other parts of the component's compound component, like `TabsList` for `TabsTrigger`,
 * one of which may render the parent it needs. A component may be the root itself, like a
 * `MessageScroller` needing its `MessageScrollerProvider`.
 */
const findSiblingParts = (query: ParentQuery): Wrapper[] => {
  const rootName = getCompoundRootNames(query)[0] ?? query.name;
  return [...query.project.exports.keys()]
    .filter(
      (candidate) =>
        candidate !== rootName && candidate !== query.name && candidate.startsWith(rootName),
    )
    .flatMap((candidate) => findOwnExport(candidate, query));
};

/**
 * The contexts the component reads, first one an error says a hook found empty, named after
 * the hook, like `UIAppStateContext` for `useUIAppState(...)`, which a child may read.
 */
const findContextProviders = (query: ParentQuery): Wrapper[] => {
  const hookName = NULL_HOOK_PATTERN.exec(query.error)?.[1];
  const hookContextName = hookName
    ? `${hookName.slice("use".length).replace(CONTEXT_SUFFIX, "")}Context`
    : null;
  const hookContextKeys = [...query.project.contextSamples.keys()].filter(
    (contextKey) => hookContextName !== null && contextKey.endsWith(`#${hookContextName}`),
  );
  return [...hookContextKeys, ...query.analysis.contextSamples.keys()].flatMap((contextKey) => {
    const separatorIndex = contextKey.lastIndexOf("#");
    const file = contextKey.slice(0, separatorIndex);
    const name = contextKey.slice(separatorIndex + 1);
    return (query.project.exports.get(name) ?? [])
      .filter((exported) => exported.file === file)
      .map((exported) => createProjectWrapper(name, exported, query));
  });
};

/**
 * Every parent that may fix an error, in the order to try them: the parent it names, then
 * the component's compound roots, its sibling parts and the providers of contexts it reads.
 * A parent named for a library part the component's own outermost root renders, like a vaul
 * `DrawerTitle` asking for Radix's `Dialog`, is that root first.
 */
export const proposeParents = (query: ParentQuery): Wrapper[] => {
  const namedParent = query.isNamingParent ? getNamedParent(query.error, query.project) : null;
  const rootNames = getCompoundRootNames(query);
  const outerRoots = rootNames.slice(-1).flatMap((rootName) => findOwnExport(rootName, query));
  const innerRoots = rootNames.slice(0, -1).flatMap((rootName) => findOwnExport(rootName, query));
  const namedParents = namedParent ? findNamedParents(namedParent, query) : [];
  const isNamedInOwnFile = namedParents.some(
    ({ candidate }) => candidate.kind === "project" && candidate.file === query.file,
  );
  const ordered =
    namedParents.length > 0 && !isNamedInOwnFile
      ? [...outerRoots, ...namedParents, ...innerRoots]
      : [...namedParents, ...innerRoots, ...outerRoots];
  return [...ordered, ...findSiblingParts(query), ...findContextProviders(query)];
};
