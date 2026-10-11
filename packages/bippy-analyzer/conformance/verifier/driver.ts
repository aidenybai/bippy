import type { Page } from "playwright";
import type { ComponentAnalysis, Sample } from "../../src/core/types.js";
import { normalizeShapes } from "./match.js";
import { classifyMountError } from "./reasons.js";
import type { MountFailure } from "./reasons.js";
import type { Action, Capture, MountRequest, Wrapper } from "./types.js";
import { findCompoundRoot, findWrapper, getErrorSubject } from "./wrappers.js";

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
const ASYNC_COMPONENT_ERROR = "async server component, which renders only on a server";
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
 * same. Returns the parents it needed, outermost first. An error that names no parent, like
 * cmdk's parts reading a store their `Command` root provides, still gets the compound root
 * the component's file exports.
 */
export const resolveWrappers = async (
  page: Page,
  request: MountRequest,
  analysis: ComponentAnalysis,
  exportIndex: Map<string, string[]>,
): Promise<Wrapper[]> => {
  const wrappers: Wrapper[] = [];
  let added: { index: number; error: string } | null = null;
  while (wrappers.length < MAX_WRAPPERS) {
    const capture = await mountInPage(page, { ...request, wrappers });
    if (!capture.error || capture.shapes.length > 0) break;
    const retried = added?.error === capture.error ? wrappers[added.index] : undefined;
    if (added && retried && retried.candidates.length > 1) {
      wrappers[added.index] = { ...retried, candidates: retried.candidates.slice(1) };
      continue;
    }
    const failure = classifyMountError(capture.error);
    if (!PARENT_FAILURES.has(failure)) break;
    const isWrapped = (candidate: Wrapper | null): boolean =>
      candidate === null || wrappers.some((existing) => existing.name === candidate.name);
    const errorWrapper =
      failure === "provider" ? findWrapper(capture.error, analysis.file, exportIndex) : null;
    const wrapper = isWrapped(errorWrapper)
      ? findCompoundRoot(analysis.name, analysis.file, exportIndex)
      : errorWrapper;
    if (!wrapper || isWrapped(wrapper)) break;
    const index = capture.errorDepth ?? getWrapperIndex(capture.error, analysis.name, wrappers);
    wrappers.splice(index, 0, wrapper);
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
  exportIndex: Map<string, string[]>,
): Promise<Observation[]> => {
  const { exportName } = analysis;
  if (!exportName) return [];
  if (analysis.isAsync) throw new Error(ASYNC_COMPONENT_ERROR);
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
    exportIndex,
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
