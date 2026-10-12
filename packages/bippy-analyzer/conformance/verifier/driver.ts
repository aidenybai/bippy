import type { Page } from "playwright";
import type { ComponentAnalysis, Sample } from "../../src/core/types.js";
import { normalizeShapes } from "./match.js";
import { classifyMountError } from "./reasons.js";
import type { MountFailure } from "./reasons.js";
import type { Action, Capture, MountRequest, ProjectIndex, Wrapper } from "./types.js";
import { getPropCombinations } from "./props.js";
import { getErrorSubject, proposeParents } from "./wrappers.js";

export interface Observation {
  props: Record<string, Sample>;
  path: string[];
  action: Action | null;
  before: Capture | null;
  after: Capture;
}

const MAX_ACTION_DEPTH = 3;
const MAX_ACTIONS_PER_COMBINATION = 120;
const MAX_WRAPPERS = 8;
const MAX_MOUNT_ATTEMPTS = 24;
const PAGE_TIMEOUT_MS = 30_000;
const PARENT_FAILURES = new Set<MountFailure>(["provider", "missing-data", "other"]);

// HACK: a component that renders `<html>` replaces the harness document, leaving the page
// unresponsive.
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

interface Layer {
  proposals: Wrapper[];
  cursor: number;
  error: string;
}

const getLayerWrapper = (layer: Layer): Wrapper | undefined => layer.proposals[layer.cursor];

const getInsertIndex = (error: string, componentName: string, layers: Layer[]): number => {
  const subject = getErrorSubject(error);
  const subjectIndex = layers.findIndex((layer) => getLayerWrapper(layer)?.name === subject);
  if (subjectIndex !== -1) return subjectIndex;
  const isComponent = subject !== null && componentName.endsWith(subject);
  return isComponent || layers.length === 0 ? layers.length : 0;
};

export const resolveWrappers = async (
  page: Page,
  request: MountRequest,
  analysis: ComponentAnalysis,
  project: ProjectIndex,
): Promise<Wrapper[]> => {
  const layers: Layer[] = [];
  let newest: Layer | null = null;
  const getWrappers = (): Wrapper[] => layers.flatMap((layer) => getLayerWrapper(layer) ?? []);
  const proposeFor = (name: string, file: string, error: string, failure: MountFailure) => {
    const usedNames = new Set([analysis.name, ...getWrappers().map((wrapper) => wrapper.name)]);
    return proposeParents({
      name,
      file,
      error,
      isNamingParent: failure === "provider",
      analysis,
      project,
    }).filter((wrapper) => !usedNames.has(wrapper.name));
  };
  for (let attempt = 0; attempt < MAX_MOUNT_ATTEMPTS && layers.length <= MAX_WRAPPERS; attempt++) {
    const capture = await mountInPage(page, { ...request, wrappers: getWrappers() });
    if (!capture.error || capture.shapes.length > 0) break;
    const failure = classifyMountError(capture.error);
    const thrower = capture.errorDepth === null ? undefined : layers[capture.errorDepth];
    if (newest) {
      const newestIndex = layers.indexOf(newest);
      const newestWrapper = getLayerWrapper(newest);
      // A new parent throwing the same error itself is the right one but needs its own parent.
      if (
        thrower === newest &&
        capture.error === newest.error &&
        newestWrapper?.candidate.kind === "project"
      ) {
        const proposals = proposeFor(
          newestWrapper.candidate.exportName,
          newestWrapper.candidate.file,
          capture.error,
          failure,
        );
        if (proposals.length > 0) {
          newest = { proposals, cursor: 0, error: capture.error };
          layers.splice(newestIndex, 0, newest);
          continue;
        }
      }
      // An earlier parent made redundant by an outer one throws for missing data, so drop it.
      if (thrower && thrower !== newest && (failure === "missing-data" || failure === "other")) {
        layers.splice(layers.indexOf(thrower), 1);
        newest = null;
        continue;
      }
      const isBrokenByNewest =
        failure === "other" && capture.errorDepth !== null && capture.errorDepth <= newestIndex;
      if (capture.error === newest.error || failure === "did-not-render" || isBrokenByNewest) {
        newest.cursor++;
        if (getLayerWrapper(newest)) continue;
        layers.splice(newestIndex, 1);
        break;
      }
    }
    if (!PARENT_FAILURES.has(failure)) break;
    const proposals = proposeFor(analysis.name, analysis.file, capture.error, failure);
    if (proposals.length === 0) break;
    newest = { proposals, cursor: 0, error: capture.error };
    layers.splice(
      capture.errorDepth ?? getInsertIndex(capture.error, analysis.name, layers),
      0,
      newest,
    );
  }
  return getWrappers();
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
