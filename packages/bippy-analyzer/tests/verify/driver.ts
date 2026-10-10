import type { Page } from "playwright";
import type { ComponentAnalysis, Sample } from "../../src/core/inference/types.js";
import { normalizeShapes } from "./match.js";
import type { Action, Capture, MountRequest } from "./types.js";

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

const getPropCombinations = (analysis: ComponentAnalysis): Record<string, Sample>[] => {
  const props = analysis.bindings.flatMap((binding) =>
    binding.kind === "prop" && binding.propName && binding.samples.length > 0
      ? [{ name: binding.propName, samples: binding.samples }]
      : [],
  );
  const base = Object.fromEntries(
    props.map(({ name, samples }) => [name, samples[0] ?? { kind: "Undefined" }]),
  );
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
): Promise<Observation[]> => {
  const { exportName } = analysis;
  if (!exportName) return [];
  const observations: Observation[] = [];

  for (const props of getPropCombinations(analysis)) {
    const request: MountRequest = { moduleUrl, exportName, props };
    const mount = (): Promise<Capture> =>
      page.evaluate((mountRequest) => window.__verify.mount(mountRequest), request);
    const perform = (actionKey: string): Promise<Capture | null> =>
      page.evaluate((key) => window.__verify.perform(key), actionKey);
    const replay = async (path: string[]): Promise<Capture | null> => {
      let capture: Capture | null = await mount();
      for (const actionKey of path) {
        capture = await perform(actionKey);
        if (!capture) return null;
      }
      return capture;
    };

    const initial = await mount();
    observations.push({ props, path: [], action: null, before: null, after: initial });
    if (initial.error && initial.shapes.length === 0) continue;

    const seen = new Set([getCaptureKey(initial)]);
    const queue: string[][] = [[]];
    let actionCount = 0;

    for (const currentPath of queue) {
      if (actionCount >= MAX_ACTIONS_PER_COMBINATION) break;
      if (currentPath.length >= MAX_ACTION_DEPTH) continue;
      if (!(await replay(currentPath))) continue;
      const actions: Action[] = await page.evaluate(() => window.__verify.actions());
      for (const action of actions) {
        if (actionCount >= MAX_ACTIONS_PER_COMBINATION) break;
        const before = await replay(currentPath);
        if (!before) continue;
        const after = await perform(action.key);
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
