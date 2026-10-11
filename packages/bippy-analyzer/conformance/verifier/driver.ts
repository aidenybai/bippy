import type { Page } from "playwright";
import type { ComponentAnalysis, Sample } from "../../src/core/types.js";
import { normalizeShapes } from "./match.js";
import { classifyMountError } from "./reasons.js";
import type { Action, Capture, MountRequest, Wrapper } from "./types.js";
import { findWrapper, getErrorSubject } from "./wrappers.js";

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
const MAX_WRAPPERS = 4;

export const mountInPage = (page: Page, request: MountRequest): Promise<Capture> =>
  page.evaluate((mountRequest) => window.__verify.mount(mountRequest), request);

export const performInPage = (page: Page, actionKey: string): Promise<Capture | null> =>
  page.evaluate((key) => window.__verify.perform(key), actionKey);

export const listActionsInPage = (page: Page): Promise<Action[]> =>
  page.evaluate(() => window.__verify.actions());

/**
 * Mounts a component, and while it throws for want of a parent, finds that parent and
 * mounts it again inside. Returns the parents it needed, outermost first.
 */
export const resolveWrappers = async (
  page: Page,
  request: MountRequest,
  componentFile: string,
  exportIndex: Map<string, string[]>,
): Promise<Wrapper[]> => {
  const wrappers: Wrapper[] = [];
  while (wrappers.length < MAX_WRAPPERS) {
    const capture = await mountInPage(page, { ...request, wrappers });
    if (!capture.error || capture.shapes.length > 0) break;
    if (classifyMountError(capture.error) !== "provider") break;
    const wrapper = findWrapper(capture.error, componentFile, exportIndex);
    if (!wrapper || wrappers.some((existing) => existing.name === wrapper.name)) break;
    const subject = getErrorSubject(capture.error);
    const subjectIndex = wrappers.findIndex((existing) => existing.name === subject);
    wrappers.splice(subjectIndex === -1 ? wrappers.length : subjectIndex, 0, wrapper);
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
 * The first sample of every prop the analysis knows, the props a component mounts with when
 * nothing else is chosen.
 */
export const getDefaultProps = (analysis: ComponentAnalysis): Record<string, Sample> =>
  Object.fromEntries(
    getPropSamples(analysis).map(({ name, samples }) => [
      name,
      samples[0] ?? { kind: "Undefined" },
    ]),
  );

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
      [{}],
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
    analysis.file,
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
