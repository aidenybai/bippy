import type { Page } from "playwright";
import type { ComponentAnalysis, Sample } from "../../../src/core/types";
import { normalizeShapes } from "./match";
import { HarnessError, getCaptureFailure } from "./reasons";
import type { MountFailure } from "./reasons";
import type {
  Action,
  Capture,
  ComponentModule,
  MountRequest,
  ProjectIndex,
  Wrapper,
} from "./types";
import { getPropCombinations } from "./props";
import { findRootParts, getErrorSubject, resolveNamedParent, proposeParents } from "./wrappers";
import type { ParentQuery } from "./wrappers";

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
const REDUNDANT_PARENT_FAILURES = new Set<MountFailure>(["missing-data", "other"]);

const withTimeout = <Result>(promise: Promise<Result>): Promise<Result> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new HarnessError("unresponsive", `page stopped responding after ${PAGE_TIMEOUT_MS} ms`),
          ),
        PAGE_TIMEOUT_MS,
      ).unref(),
    ),
  ]);

export const mountInPage = (page: Page, request: MountRequest): Promise<Capture> =>
  withTimeout(page.evaluate((mountRequest) => window.__verify.mount(mountRequest), request));

export const performInPage = (page: Page, actionKey: string): Promise<Capture | null> =>
  withTimeout(page.evaluate((key) => window.__verify.perform(key), actionKey));

const canLoadInPage = (page: Page, wrapper: Wrapper): Promise<boolean> =>
  withTimeout(page.evaluate((candidate) => window.__verify.canLoad(candidate), wrapper));

export const listActionsInPage = (page: Page): Promise<Action[]> =>
  withTimeout(page.evaluate(() => window.__verify.actions()));

interface ResolvedWrappers {
  wrappers: Wrapper[];
  mounted: Capture | null;
}

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

interface FailedMount {
  error: string;
  errorDepth: number | null;
  failure: MountFailure;
}

type LayerRevision = "retry" | "give-up" | "unchanged";

class WrapperSearch {
  readonly #page: Page;
  readonly #analysis: ComponentAnalysis;
  readonly #project: ProjectIndex;
  readonly #layers: Layer[] = [];
  #newestLayer: Layer | null = null;

  constructor(page: Page, analysis: ComponentAnalysis, project: ProjectIndex) {
    this.#page = page;
    this.#analysis = analysis;
    this.#project = project;
  }

  get wrappers(): Wrapper[] {
    return this.#layers.flatMap((layer) => getLayerWrapper(layer) ?? []);
  }

  get layerCount(): number {
    return this.#layers.length;
  }

  async reviseNewestLayer(failedMount: FailedMount): Promise<LayerRevision> {
    const newestLayer = this.#newestLayer;
    if (!newestLayer) return "unchanged";
    const throwingLayer =
      failedMount.errorDepth === null ? undefined : this.#layers[failedMount.errorDepth];
    const isSameError = failedMount.error === newestLayer.error;
    if (
      isSameError &&
      throwingLayer === newestLayer &&
      (await this.#addNamedParent(newestLayer, failedMount))
    )
      return "retry";
    const isRootShort = isSameError ? throwingLayer === undefined : throwingLayer === newestLayer;
    if (isRootShort && (await this.#addRootParts(newestLayer, failedMount))) return "retry";
    if (
      throwingLayer &&
      throwingLayer !== newestLayer &&
      REDUNDANT_PARENT_FAILURES.has(failedMount.failure)
    ) {
      this.#layers.splice(this.#layers.indexOf(throwingLayer), 1);
      this.#newestLayer = null;
      return "retry";
    }
    return this.#advanceNewestLayer(newestLayer, failedMount, isSameError);
  }

  async #addNamedParent(newestLayer: Layer, failedMount: FailedMount): Promise<boolean> {
    const newestWrapper = getLayerWrapper(newestLayer);
    if (
      newestWrapper?.candidate.kind !== "project" ||
      newestWrapper.name !== resolveNamedParent(failedMount.error, this.#project)
    )
      return false;
    const { exportName, file } = newestWrapper.candidate;
    return this.#tryAddLayer(
      proposeParents(this.#getQuery(exportName, file, failedMount)),
      failedMount.error,
      this.#layers.indexOf(newestLayer),
    );
  }

  async #addRootParts(newestLayer: Layer, failedMount: FailedMount): Promise<boolean> {
    const root = getLayerWrapper(newestLayer);
    if (root?.source !== "root") return false;
    return this.#tryAddLayer(
      findRootParts(root, this.#getQuery(this.#analysis.name, this.#analysis.file, failedMount)),
      failedMount.error,
      this.#layers.indexOf(newestLayer) + 1,
    );
  }

  async #advanceNewestLayer(
    newestLayer: Layer,
    failedMount: FailedMount,
    isSameError: boolean,
  ): Promise<LayerRevision> {
    const newestIndex = this.#layers.indexOf(newestLayer);
    const isBrokenByNewest =
      failedMount.failure === "other" &&
      failedMount.errorDepth !== null &&
      failedMount.errorDepth <= newestIndex;
    if (!isSameError && failedMount.failure !== "did-not-render" && !isBrokenByNewest)
      return "unchanged";
    newestLayer.cursor++;
    if (await this.#advanceToLoadable(newestLayer)) return "retry";
    this.#layers.splice(newestIndex, 1);
    return "give-up";
  }

  async addParentLayer(failedMount: FailedMount): Promise<boolean> {
    const parentQuery = this.#getQuery(this.#analysis.name, this.#analysis.file, failedMount);
    const insertIndex =
      failedMount.errorDepth ??
      getInsertIndex(failedMount.error, this.#analysis.name, this.#layers);
    return this.#tryAddLayer(proposeParents(parentQuery), failedMount.error, insertIndex);
  }

  #getQuery(name: string, file: string, failedMount: FailedMount): ParentQuery {
    return {
      name,
      file,
      error: failedMount.error,
      isNamingParent: failedMount.failure === "provider",
      analysis: this.#analysis,
      project: this.#project,
    };
  }

  async #tryAddLayer(proposals: Wrapper[], error: string, insertIndex: number): Promise<boolean> {
    const usedNames = new Set([
      this.#analysis.name,
      ...this.wrappers.map((wrapper) => wrapper.name),
    ]);
    const layer: Layer = {
      proposals: proposals.filter((proposal) => !usedNames.has(proposal.name)),
      cursor: 0,
      error,
    };
    if (!(await this.#advanceToLoadable(layer))) return false;
    this.#newestLayer = layer;
    this.#layers.splice(insertIndex, 0, layer);
    return true;
  }

  async #advanceToLoadable(layer: Layer): Promise<boolean> {
    for (let wrapper = getLayerWrapper(layer); wrapper; wrapper = getLayerWrapper(layer)) {
      if (await canLoadInPage(this.#page, wrapper)) return true;
      layer.cursor++;
    }
    return false;
  }
}

export const resolveWrappers = async (
  page: Page,
  request: MountRequest,
  analysis: ComponentAnalysis,
  project: ProjectIndex,
): Promise<ResolvedWrappers> => {
  const search = new WrapperSearch(page, analysis, project);
  for (
    let attempt = 0;
    attempt < MAX_MOUNT_ATTEMPTS && search.layerCount <= MAX_WRAPPERS;
    attempt++
  ) {
    const capture = await mountInPage(page, { ...request, wrappers: search.wrappers });
    if (!capture.error || capture.shapes.length > 0)
      return { wrappers: search.wrappers, mounted: capture };
    const failedMount: FailedMount = {
      error: capture.error,
      errorDepth: capture.errorDepth,
      failure: getCaptureFailure(capture),
    };
    const revision = await search.reviseNewestLayer(failedMount);
    if (revision === "retry") continue;
    if (revision === "give-up" || !PARENT_FAILURES.has(failedMount.failure)) break;
    if (!(await search.addParentLayer(failedMount))) break;
  }
  return { wrappers: search.wrappers, mounted: null };
};

const getCaptureKey = (capture: Capture): string =>
  JSON.stringify([normalizeShapes(capture.shapes), capture.hookStates]);

const replayPath = async (
  page: Page,
  request: MountRequest,
  path: string[],
): Promise<Capture | null> => {
  let capture: Capture | null = await mountInPage(page, request);
  for (const actionKey of path) {
    capture = await performInPage(page, actionKey);
    if (!capture) return null;
  }
  return capture;
};

const explorePropCombination = async (
  page: Page,
  request: MountRequest,
  initialCapture: Capture,
): Promise<Observation[]> => {
  const { props } = request;
  const observations: Observation[] = [
    { props, path: [], action: null, before: null, after: initialCapture },
  ];
  if (initialCapture.error && initialCapture.shapes.length === 0) return observations;
  const seenCaptureKeys = new Set([getCaptureKey(initialCapture)]);
  const pendingPaths: string[][] = [[]];
  let actionCount = 0;
  for (const currentPath of pendingPaths) {
    if (actionCount >= MAX_ACTIONS_PER_COMBINATION) break;
    if (currentPath.length >= MAX_ACTION_DEPTH) continue;
    if (currentPath.length > 0 && !(await replayPath(page, request, currentPath))) continue;
    for (const action of await listActionsInPage(page)) {
      if (actionCount >= MAX_ACTIONS_PER_COMBINATION) break;
      const before = await replayPath(page, request, currentPath);
      if (!before) continue;
      const after = await performInPage(page, action.key);
      if (!after) continue;
      actionCount++;
      const path = [...currentPath, action.key];
      observations.push({ props, path, action, before, after });
      const captureKey = getCaptureKey(after);
      if (!seenCaptureKeys.has(captureKey)) {
        seenCaptureKeys.add(captureKey);
        pendingPaths.push(path);
      }
    }
  }
  return observations;
};

export const exploreComponent = async (
  page: Page,
  analysis: ComponentAnalysis,
  module: ComponentModule,
  project: ProjectIndex,
): Promise<Observation[]> => {
  const { exportName } = analysis;
  if (!exportName) return [];
  const propCombinations = getPropCombinations(analysis);
  const [firstProps = {}] = propCombinations;
  const resolved = await resolveWrappers(
    page,
    { module, exportName, props: firstProps, scenario: null, wrappers: [] },
    analysis,
    project,
  );
  const observations: Observation[] = [];
  for (const props of propCombinations) {
    const request: MountRequest = {
      module,
      exportName,
      props,
      scenario: null,
      wrappers: resolved.wrappers,
    };
    const initialCapture =
      resolved.mounted && props === propCombinations[0]
        ? resolved.mounted
        : await mountInPage(page, request);
    observations.push(...(await explorePropCombination(page, request, initialCapture)));
  }
  return observations;
};
