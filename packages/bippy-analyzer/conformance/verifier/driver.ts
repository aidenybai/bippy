import type { Page } from "playwright";
import type { ComponentAnalysis, Sample } from "../../src/core/types.js";
import { normalizeShapes } from "./match.js";
import { classifyMountError } from "./reasons.js";
import type { MountFailure } from "./reasons.js";
import type { Action, Capture, MountRequest, ProjectIndex, Wrapper } from "./types.js";
import {
  findCompoundRoot,
  findContextProvider,
  findSiblingParts,
  findWrapper,
  getErrorSubject,
  getNamedContextKeys,
} from "./wrappers.js";

export interface Observation {
  props: Record<string, Sample>;
  path: string[];
  action: Action | null;
  before: Capture | null;
  after: Capture;
}

const MAX_PROP_COMBINATIONS = 12;
const MAX_ACTION_DEPTH = 3;
const MAX_ACTIONS_PER_COMBINATION = 120;
const MAX_WRAPPERS = 8;
const MAX_MOUNT_ATTEMPTS = 24;
const PAGE_TIMEOUT_MS = 30_000;
const PARENT_FAILURES = new Set<MountFailure>(["provider", "missing-data", "other"]);

/**
 * Gives up on a page that stops answering, like one whose component rendered `<html>` and
 * so replaced the harness document.
 */
const withTimeout = <Result>(promise: Promise<Result>): Promise<Result> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`page stopped responding after ${PAGE_TIMEOUT_MS} ms`)),
        PAGE_TIMEOUT_MS,
      ).unref(),
    ),
  ]);

export const mountInPage = (page: Page, request: MountRequest): Promise<Capture> =>
  withTimeout(page.evaluate((mountRequest) => window.__verify.mount(mountRequest), request));

export const performInPage = (page: Page, actionKey: string): Promise<Capture | null> =>
  withTimeout(page.evaluate((key) => window.__verify.perform(key), actionKey));

export const listActionsInPage = (page: Page): Promise<Action[]> =>
  withTimeout(page.evaluate(() => window.__verify.actions()));

/**
 * Where a newly found parent goes among the wrappers, outermost first, when React didn't say
 * which of them threw: around the wrapper the error is about, inside them all when it is
 * about the component itself, under its own name or the end of it, like Radix's
 * `MenuSubTrigger` inside `DropdownMenuSubTrigger`, and otherwise outside them all, since
 * then a wrapper threw under a name of its package's own, like `MenubarMenu` for a `Menu`
 * wrapper.
 */
const getWrapperIndex = (error: string, componentName: string, wrappers: Wrapper[]): number => {
  const subject = getErrorSubject(error);
  const subjectIndex = wrappers.findIndex((existing) => existing.name === subject);
  if (subjectIndex !== -1) return subjectIndex;
  const isComponent = subject !== null && componentName.endsWith(subject);
  return isComponent || wrappers.length === 0 ? wrappers.length : 0;
};

/**
 * Mounts a component, and while it throws for want of a parent, finds that parent and
 * mounts it again inside, trying the parent's next candidate while the error stays the
 * same or the parent doesn't render the component at all, like a part that renders nothing
 * until something is selected. Returns the parents it needed, outermost first. An error that
 * names no parent, like cmdk's parts reading a store their `Command` root provides, still
 * gets the compound root the component's file exports, then its other parts, one at a time,
 * and then the providers of the contexts it reads, starting with one named after a hook the
 * error says came up empty, like `UIAppStateContext` for `useUIAppState(...)`, which a child
 * it renders may read.
 */
export const resolveWrappers = async (
  page: Page,
  request: MountRequest,
  analysis: ComponentAnalysis,
  project: ProjectIndex,
): Promise<Wrapper[]> => {
  const { exports: exportIndex } = project;
  const wrappers: Wrapper[] = [];
  let added: { index: number; error: string } | null = null;
  for (let attempt = 0; attempt < MAX_MOUNT_ATTEMPTS && wrappers.length < MAX_WRAPPERS; attempt++) {
    const capture = await mountInPage(page, { ...request, wrappers });
    if (!capture.error || capture.shapes.length > 0) break;
    const failure = classifyMountError(capture.error);
    // A parent added earlier that now throws for want of data is no longer needed, as one
    // added outside it provides what it stood in for, like a bare `Toast.Root` inside the
    // app's `Toast`, which passes it the toast it reads.
    if (
      added !== null &&
      capture.errorDepth !== null &&
      capture.errorDepth < wrappers.length &&
      capture.errorDepth !== added.index &&
      (failure === "missing-data" || failure === "other")
    ) {
      wrappers.splice(capture.errorDepth, 1);
      added = null;
      continue;
    }
    // The parent just added threw an error no further parent fixes, like a part that renders
    // an `<input>` with children, when React's component stack places it at or above it.
    const isParentBroken =
      added !== null &&
      failure === "other" &&
      capture.errorDepth !== null &&
      capture.errorDepth <= added.index;
    // The parent just added throws the same error itself, so it is the right parent and needs
    // one of its own parts around it, like a `MessageScroller` its `MessageScrollerProvider`.
    const parent = added && capture.errorDepth === added.index ? wrappers[added.index] : undefined;
    const parentCandidate = added?.error === capture.error ? parent?.candidates[0] : undefined;
    const parentParts = parentCandidate
      ? findSiblingParts(parentCandidate.exportName, parentCandidate.specifier, exportIndex)
      : null;
    if (added && parentParts && !wrappers.some((existing) => existing.name === parentParts.name)) {
      wrappers.splice(added.index, 0, withSampledProps(parentParts, project, analysis));
      continue;
    }
    const isRejected =
      added?.error === capture.error || failure === "did-not-render" || isParentBroken;
    const retried = added && isRejected ? wrappers[added.index] : undefined;
    if (added && retried && retried.candidates.length > 1) {
      wrappers[added.index] = { ...retried, candidates: retried.candidates.slice(1) };
      continue;
    }
    if (!PARENT_FAILURES.has(failure)) break;
    // A parent named after the component itself, as when it throws for want of its own
    // provider part, can't be what it needs.
    const isWrapped = (candidate: Wrapper | null): boolean =>
      candidate === null ||
      candidate.name === analysis.name ||
      wrappers.some((existing) => existing.name === candidate.name);
    const namedWrapper =
      failure === "provider" ? findWrapper(capture.error, analysis.file, exportIndex) : null;
    const ownRoot = findCompoundRoot(analysis.name, analysis.file, exportIndex);
    // A parent named for a library part the component's own root renders, like a vaul
    // `DrawerTitle` asking for Radix's `Dialog`, is its root, not another file's `Dialog`.
    const errorWrapper =
      namedWrapper &&
      ownRoot &&
      !isWrapped(ownRoot) &&
      !namedWrapper.candidates.some((candidate) => candidate.specifier === analysis.file)
        ? { ...namedWrapper, candidates: [...ownRoot.candidates, ...namedWrapper.candidates] }
        : namedWrapper;
    const compoundRoot = isWrapped(errorWrapper) ? ownRoot : errorWrapper;
    const siblingParts = isWrapped(compoundRoot)
      ? findSiblingParts(analysis.name, analysis.file, exportIndex)
      : compoundRoot;
    const wrapper = isWrapped(siblingParts)
      ? findContextProvider(
          [
            ...getNamedContextKeys(capture.error, project.contextSamples.keys()),
            ...analysis.contextSamples.keys(),
          ],
          analysis.file,
          exportIndex,
          (name) => wrappers.some((existing) => existing.name === name),
        )
      : siblingParts;
    if (!wrapper || isWrapped(wrapper)) break;
    const sampledWrapper = withSampledProps(wrapper, project, analysis);
    const index = capture.errorDepth ?? getWrapperIndex(capture.error, analysis.name, wrappers);
    wrappers.splice(index, 0, sampledWrapper);
    added = { index, error: capture.error };
  }
  return wrappers;
};

const getPropSamples = (analysis: ComponentAnalysis) =>
  analysis.bindings.flatMap((binding) =>
    binding.kind === "prop" && binding.propName && binding.samples.length > 0
      ? [{ name: binding.propName, samples: binding.samples }]
      : [],
  );

/**
 * Props a component reads only through the whole props object, which mount from a sample
 * of its props type beneath the props the analysis knows.
 */
const getWholeProps = (analysis: ComponentAnalysis): Record<string, Sample> =>
  analysis.propsSample?.kind === "Object" ? analysis.propsSample.fields : {};

/**
 * The first sample of every prop the analysis knows, the props a component mounts with when
 * nothing else is chosen.
 */
export const getDefaultProps = (analysis: ComponentAnalysis): Record<string, Sample> => ({
  ...getWholeProps(analysis),
  ...Object.fromEntries(
    getPropSamples(analysis).map(({ name, samples }) => [
      name,
      samples[0] ?? { kind: "Undefined" },
    ]),
  ),
});

/**
 * Gives each candidate from the project the props its own analysis would mount it with, as
 * a parent like a sortable list needs its items to render its parts at all, and a context
 * the value the component reads from it.
 */
const withSampledProps = (
  wrapper: Wrapper,
  project: ProjectIndex,
  analysis: ComponentAnalysis,
): Wrapper => ({
  ...wrapper,
  candidates: wrapper.candidates.map((candidate) => {
    const key = `${candidate.specifier}#${candidate.exportName}`;
    const parentAnalysis = project.components.get(key);
    const contextSample = analysis.contextSamples.get(key) ?? project.contextSamples.get(key);
    if (parentAnalysis) return { ...candidate, props: getDefaultProps(parentAnalysis) };
    return contextSample ? { ...candidate, props: { value: contextSample } } : candidate;
  }),
});

const getPropCombinations = (analysis: ComponentAnalysis): Record<string, Sample>[] => {
  const props = getPropSamples(analysis);
  const base = getDefaultProps(analysis);
  const fullCount = props.reduce((total, { samples }) => total * samples.length, 1);
  if (fullCount <= MAX_PROP_COMBINATIONS) {
    return props.reduce<Record<string, Sample>[]>(
      (combinations, { name, samples }) =>
        combinations.flatMap((combination) =>
          samples.map((sample) => ({ ...combination, [name]: sample })),
        ),
      [getWholeProps(analysis)],
    );
  }
  const variations = props.flatMap(({ name, samples }) =>
    samples.slice(1).map((sample) => ({ ...base, [name]: sample })),
  );
  return [base, ...variations].slice(0, MAX_PROP_COMBINATIONS);
};

const getCaptureKey = (capture: Capture): string =>
  JSON.stringify([normalizeShapes(capture.shapes), capture.hookStates]);

export const exploreComponent = async (
  page: Page,
  analysis: ComponentAnalysis,
  moduleUrl: string,
  project: ProjectIndex,
): Promise<Observation[]> => {
  const { exportName } = analysis;
  if (!exportName) return [];
  const observations: Observation[] = [];
  const propCombinations = getPropCombinations(analysis);
  const wrappers = await resolveWrappers(
    page,
    {
      moduleUrl,
      exportName,
      props: propCombinations[0] ?? {},
      scenario: null,
      wrappers: [],
    },
    analysis,
    project,
  );

  for (const props of propCombinations) {
    const request: MountRequest = { moduleUrl, exportName, props, scenario: null, wrappers };
    const replay = async (path: string[]): Promise<Capture | null> => {
      let capture: Capture | null = await mountInPage(page, request);
      for (const actionKey of path) {
        capture = await performInPage(page, actionKey);
        if (!capture) return null;
      }
      return capture;
    };

    const initial = await mountInPage(page, request);
    observations.push({ props, path: [], action: null, before: null, after: initial });
    if (initial.error && initial.shapes.length === 0) continue;

    const seen = new Set([getCaptureKey(initial)]);
    const queue: string[][] = [[]];
    let actionCount = 0;

    for (const currentPath of queue) {
      if (actionCount >= MAX_ACTIONS_PER_COMBINATION) break;
      if (currentPath.length >= MAX_ACTION_DEPTH) continue;
      if (!(await replay(currentPath))) continue;
      const actions = await listActionsInPage(page);
      for (const action of actions) {
        if (actionCount >= MAX_ACTIONS_PER_COMBINATION) break;
        const before = await replay(currentPath);
        if (!before) continue;
        const after = await performInPage(page, action.key);
        if (!after) continue;
        actionCount++;
        const path = [...currentPath, action.key];
        observations.push({ props, path, action, before, after });
        const key = getCaptureKey(after);
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(path);
        }
      }
    }
  }
  return observations;
};
