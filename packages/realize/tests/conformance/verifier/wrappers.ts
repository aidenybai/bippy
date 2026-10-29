import { sep } from "node:path";
import type { ComponentAnalysis } from "../../../src/core/types";
import {
  createDeclarationKey,
  parseDeclarationKey,
} from "../../../src/core/project/declaration-key";
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
  if (!named || project.exports.has(named)) return named ?? null;
  const candidates = [named.replace(CONTEXT_SUFFIX, "Provider"), named.replaceAll(".", "")];
  return candidates.find((candidate) => project.exports.has(candidate)) ?? named;
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

const getHookSubject = (error: string): string | null => {
  const hookName = NULL_HOOK_PATTERN.exec(error)?.[1];
  return hookName ? hookName.slice("use".length).replace(CONTEXT_SUFFIX, "") : null;
};

const findExportInFile = (
  name: string,
  source: WrapperSource,
  file: string,
  query: ParentQuery,
): Wrapper[] =>
  (query.project.exports.get(name) ?? [])
    .filter((exported) => exported.file === file)
    .map((exported) => createProjectWrapper(name, source, exported, query));

const findOwnExport = (name: string, source: WrapperSource, query: ParentQuery): Wrapper[] =>
  findExportInFile(name, source, query.file, query);

const findPartsOf = (rootName: string, file: string, query: ParentQuery): Wrapper[] => {
  const hookSubject = getHookSubject(query.error);
  return [...query.project.exports.keys()]
    .filter(
      (candidate) =>
        candidate !== rootName && candidate !== query.name && candidate.startsWith(rootName),
    )
    .sort((left, right) => Number(right === hookSubject) - Number(left === hookSubject))
    .flatMap((candidate) => findExportInFile(candidate, "part", file, query));
};

export const findSiblingParts = (query: ParentQuery): Wrapper[] =>
  findPartsOf(getCompoundRootNames(query)[0] ?? query.name, query.file, query);

export const findRootParts = (root: Wrapper, query: ParentQuery): Wrapper[] =>
  root.candidate.kind === "project" ? findPartsOf(root.name, root.candidate.file, query) : [];

const findHookNamedParents = (query: ParentQuery): Wrapper[] => {
  const subject = getHookSubject(query.error);
  return subject
    ? (query.project.exports.get(subject) ?? []).map((exported) =>
        createProjectWrapper(subject, "named", exported, query),
      )
    : [];
};

const findContextProviders = (query: ParentQuery): Wrapper[] => {
  const hookSubject = getHookSubject(query.error);
  const hookContextName = hookSubject ? `${hookSubject}Context` : null;
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

const findRenderedRoots = (query: ParentQuery): Wrapper[] => {
  const reachableFiles = new Set(getReachableFiles(query));
  const roots = new Map<string, Wrapper>();
  for (const renderedName of query.analysis.renders) {
    const renderedFiles = new Set(
      (query.project.exports.get(renderedName) ?? [])
        .map(({ file }) => file)
        .filter((file) => reachableFiles.has(file)),
    );
    for (const [candidate, exported] of query.project.exports) {
      if (candidate === renderedName || !renderedName.startsWith(candidate)) continue;
      const ownExport = exported.find(({ file }) => renderedFiles.has(file));
      if (ownExport && !roots.has(candidate))
        roots.set(candidate, createProjectWrapper(candidate, "root", ownExport, query));
    }
  }
  return [...roots.values()].sort((left, right) => left.name.length - right.name.length);
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
  return [
    ...ordered,
    ...findHookNamedParents(query),
    ...findSiblingParts(query),
    ...findContextProviders(query),
    ...findRenderedRoots(query),
  ];
};
