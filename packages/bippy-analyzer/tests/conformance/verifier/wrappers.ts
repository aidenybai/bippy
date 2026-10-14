import { sep } from "node:path";
import type { ComponentAnalysis } from "../../../src/core/types";
import { createDeclarationKey, parseDeclarationKey } from "../../../src/core/utils/declaration-key";
import { getDefaultProps } from "./props";
import { extractParentNameFromError } from "./reasons";
import type { ExportedName, ProjectIndex, Wrapper, WrapperSource } from "./types";

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
  source: WrapperSource,
  { file, exportName }: ExportedName,
  query: ParentQuery,
): Wrapper => {
  const contextKey = createDeclarationKey(file, name);
  const parentAnalysis = query.project.components.get(createDeclarationKey(file, exportName));
  const contextSample =
    query.analysis.contextSamples.get(contextKey) ?? query.project.contextSamples.get(contextKey);
  const props = parentAnalysis
    ? getDefaultProps(parentAnalysis)
    : contextSample
      ? { value: contextSample }
      : {};
  return { name, source, candidate: { kind: "project", file, exportName, props } };
};

export const resolveNamedParent = (error: string, project: ProjectIndex): string | null => {
  const named = extractParentNameFromError(error)?.replace(CONTEXT_PROVIDER_SUFFIX, "");
  if (!named) return null;
  const providerName = named.replace(CONTEXT_SUFFIX, "Provider");
  return !project.exports.has(named) && project.exports.has(providerName) ? providerName : named;
};

const getReachableFiles = (query: ParentQuery): string[] => [
  query.file,
  ...(query.project.imports.get(query.file)?.files ?? []),
];

const findNamedParents = (name: string, query: ParentQuery): Wrapper[] => {
  const projectWrappers = [...(query.project.exports.get(name) ?? [])]
    .sort(
      (left, right) =>
        getSharedSegmentCount(right.file, query.file) -
        getSharedSegmentCount(left.file, query.file),
    )
    .map((exported) => createProjectWrapper(name, "named", exported, query));
  const packageWrappers = getReachableFiles(query)
    .flatMap((file) => query.project.imports.get(file)?.packages ?? [])
    .flatMap(({ specifier, names }) =>
      [null, ...names.filter((importedName) => NAMESPACE_NAME_PATTERN.test(importedName))].map(
        (namespace): Wrapper => ({
          name,
          source: "named",
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

const findOwnExport = (name: string, source: WrapperSource, query: ParentQuery): Wrapper[] =>
  (query.project.exports.get(name) ?? [])
    .filter(({ file }) => file === query.file)
    .map((exported) => createProjectWrapper(name, source, exported, query));

export const findSiblingParts = (query: ParentQuery): Wrapper[] => {
  const rootName = getCompoundRootNames(query)[0] ?? query.name;
  return [...query.project.exports.keys()]
    .filter(
      (candidate) =>
        candidate !== rootName && candidate !== query.name && candidate.startsWith(rootName),
    )
    .flatMap((candidate) => findOwnExport(candidate, "part", query));
};

const findContextProviders = (query: ParentQuery): Wrapper[] => {
  const hookName = NULL_HOOK_PATTERN.exec(query.error)?.[1];
  const hookContextName = hookName
    ? `${hookName.slice("use".length).replace(CONTEXT_SUFFIX, "")}Context`
    : null;
  const hookContextKeys = [...query.project.contextSamples.keys()].filter(
    (contextKey) =>
      hookContextName !== null && parseDeclarationKey(contextKey).name === hookContextName,
  );
  return [...hookContextKeys, ...query.analysis.contextSamples.keys()].flatMap((contextKey) => {
    const { path, name } = parseDeclarationKey(contextKey);
    return (query.project.exports.get(name) ?? [])
      .filter((exported) => exported.file === path)
      .map((exported) => createProjectWrapper(name, "context", exported, query));
  });
};

export const proposeParents = (query: ParentQuery): Wrapper[] => {
  const namedParent = query.isNamingParent ? resolveNamedParent(query.error, query.project) : null;
  const rootNames = getCompoundRootNames(query);
  const outerRoots = rootNames
    .slice(-1)
    .flatMap((rootName) => findOwnExport(rootName, "root", query));
  const innerRoots = rootNames
    .slice(0, -1)
    .flatMap((rootName) => findOwnExport(rootName, "root", query));
  const namedParents = namedParent ? findNamedParents(namedParent, query) : [];
  const reachableFiles = new Set(getReachableFiles(query));
  const isNamedReachable = namedParents.some(
    ({ candidate }) => candidate.kind === "project" && reachableFiles.has(candidate.file),
  );
  const ordered =
    namedParents.length > 0 && !isNamedReachable
      ? [...outerRoots, ...namedParents, ...innerRoots]
      : [...namedParents, ...innerRoots, ...outerRoots];
  return [...ordered, ...findSiblingParts(query), ...findContextProviders(query)];
};
