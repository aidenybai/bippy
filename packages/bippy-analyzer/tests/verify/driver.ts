import type { Page } from "playwright";
import type { ComponentModel, Sample } from "../../src/symbolic-tree/model.ts";
import { normalizeShapes } from "./match.ts";
import type { Action, Capture, MountRequest } from "./types.ts";

export interface Observation {
  props: Record<string, Sample>;
  path: string[];
  action: Action | null;
  before: Capture | null;
  after: Capture;
}

export interface ExploreLimits {
  maxPropCombinations: number;
  maxDepth: number;
  maxActionsPerCombination: number;
}

export const DEFAULT_LIMITS: ExploreLimits = {
  maxPropCombinations: 12,
  maxDepth: 3,
  maxActionsPerCombination: 120,
};

const getPropCombinations = (model: ComponentModel, limit: number): Record<string, Sample>[] => {
  const props = model.slots.flatMap((slot) =>
    slot.source === "prop" && slot.propName && slot.samples?.length
      ? [{ name: slot.propName, samples: slot.samples }]
      : [],
  );
  const base = Object.fromEntries(
    props.map(({ name, samples }) => [name, samples[0] ?? { kind: "undefined" }]),
  );
  const fullCount = props.reduce((total, { samples }) => total * samples.length, 1);
  if (fullCount <= limit) {
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
  return [base, ...variations].slice(0, limit);
};

const getCaptureKey = (capture: Capture): string =>
  JSON.stringify([normalizeShapes(capture.shapes), capture.hookStates]);

export const exploreComponent = async (
  page: Page,
  model: ComponentModel,
  moduleUrl: string,
  limits: ExploreLimits,
): Promise<Observation[]> => {
  if (!model.exportName) return [];
  const exportName = model.exportName;
  const observations: Observation[] = [];

  for (const props of getPropCombinations(model, limits.maxPropCombinations)) {
    const request: MountRequest = { moduleUrl, exportName, props };
    const mount = (): Promise<Capture> =>
      page.evaluate((mountRequest) => window.__verify.mount(mountRequest), request);
    const replay = async (path: string[]): Promise<Capture | null> => {
      let capture = await mount();
      for (const key of path) {
        await page.evaluate(() => window.__verify.actions());
        capture = await page.evaluate((actionKey) => window.__verify.perform(actionKey), key);
        if (capture.error?.startsWith("action ")) return null;
      }
      return capture;
    };

    const initial = await mount();
    observations.push({ props, path: [], action: null, before: null, after: initial });
    if (initial.error && initial.shapes.length === 0) continue;

    const seen = new Set([getCaptureKey(initial)]);
    const queue: Array<{ path: string[]; capture: Capture }> = [{ path: [], capture: initial }];
    let actionCount = 0;

    while (queue.length > 0 && actionCount < limits.maxActionsPerCombination) {
      const current = queue.shift();
      if (!current || current.path.length >= limits.maxDepth) continue;
      if (!(await replay(current.path))) continue;
      const actions: Action[] = await page.evaluate(() => window.__verify.actions());
      for (const action of actions) {
        if (actionCount >= limits.maxActionsPerCombination) break;
        const before = await replay(current.path);
        if (!before) continue;
        await page.evaluate(() => window.__verify.actions());
        const after: Capture = await page.evaluate(
          (actionKey) => window.__verify.perform(actionKey),
          action.key,
        );
        actionCount++;
        const path = [...current.path, action.key];
        observations.push({ props, path, action, before, after });
        const key = getCaptureKey(after);
        if (!seen.has(key)) {
          seen.add(key);
          queue.push({ path, capture: after });
        }
      }
    }
  }
  return observations;
};
