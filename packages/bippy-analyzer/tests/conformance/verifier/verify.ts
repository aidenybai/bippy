import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { analyzeProject } from "../../../src/core/analyze-project";
import type { AnalyzedComponent } from "../../../src/core/types";
import { createDeclarationKey, parseDeclarationKey } from "../../../src/core/utils/declaration-key";
import type { ComponentModule, ProjectIndex, SourceIndex } from "./types";
import { exploreComponent } from "./driver";
import { collectHandlerProbes } from "./handler-probes";
import { collectMutationProbes } from "./mutation";
import { collectProbes, createEmptyVerdict, scoreComponent } from "./score";
import type { ComponentVerdict } from "./score";
import { HarnessError, classifyMountError, getErrorMessage } from "./reasons";
import { readHarnessSetup } from "./harness/setup";
import { getTopLevelNames, toLocalExportName } from "./harness/local-exports";
import { getCycleImporters } from "./source-index";
import { startHarness } from "./server";
import type { Harness } from "./server";

export interface ProjectHarness extends Harness {
  getComponentModule: (file: string) => ComponentModule;
  knownComponents: Map<string, string>;
  projectIndex: ProjectIndex;
}

const createProjectIndex = (
  sourceIndex: SourceIndex,
  analyzed: AnalyzedComponent[],
): ProjectIndex => ({
  ...sourceIndex,
  components: new Map(
    analyzed.flatMap(({ analysis }) =>
      analysis.exportName
        ? [[createDeclarationKey(analysis.file, analysis.exportName), analysis]]
        : [],
    ),
  ),
  contextSamples: new Map(analyzed.flatMap(({ analysis }) => [...analysis.contextSamples])),
});

const getKnownComponents = (analyzed: AnalyzedComponent[]): Map<string, string> =>
  new Map(
    analyzed.flatMap(({ analysis }) =>
      analysis.runtimeName ? [[analysis.declaration, analysis.runtimeName]] : [],
    ),
  );

interface MountableComponents {
  components: AnalyzedComponent[];
  localNamesByFile: Map<string, string[]>;
}

const exposeLocalComponents = (components: AnalyzedComponent[]): MountableComponents => {
  const topLevelNamesByFile = new Map<string, Set<string>>();
  const localNamesByFile = new Map<string, string[]>();
  const mountable = components.map((component) => {
    const { analysis } = component;
    if (analysis.exportName) return component;
    const { name } = parseDeclarationKey(analysis.declaration);
    const topLevelNames = topLevelNamesByFile.get(analysis.file) ?? getTopLevelNames(analysis.file);
    topLevelNamesByFile.set(analysis.file, topLevelNames);
    if (!topLevelNames.has(name)) return component;
    localNamesByFile.set(analysis.file, [...(localNamesByFile.get(analysis.file) ?? []), name]);
    return { ...component, analysis: { ...analysis, exportName: toLocalExportName(name) } };
  });
  return { components: mountable, localNamesByFile };
};

export const startProjectHarness = async (
  appDirectory: string,
  analyzed: AnalyzedComponent[],
  verifiedComponents: AnalyzedComponent[],
  setupDirectory: string | null,
  localNamesByFile: Map<string, string[]> = new Map(),
): Promise<ProjectHarness> => {
  const exported = verifiedComponents.filter(({ analysis }) => analysis.exportName);
  const harness = await startHarness(
    appDirectory,
    exported.flatMap(({ analysis }) => [
      ...collectProbes(analysis),
      ...collectMutationProbes(analysis),
      ...collectHandlerProbes(analysis).map(({ probe }) => probe),
    ]),
    [...new Set(exported.map(({ analysis }) => analysis.file))],
    readHarnessSetup(setupDirectory),
    localNamesByFile,
  );
  const cycleImporters = getCycleImporters(harness.sourceIndex.imports);
  return {
    ...harness,
    getComponentModule: (file) => ({
      url: harness.getModuleUrl(file),
      importerUrls: (cycleImporters.get(file) ?? []).map(harness.getModuleUrl),
    }),
    projectIndex: createProjectIndex(harness.sourceIndex, analyzed),
    knownComponents: getKnownComponents(analyzed),
  };
};

const MAX_PAGE_ATTEMPTS = 3;
const HARNESS_LOAD_TIMEOUT_MS = 60_000;
const BROWSER_ARGUMENTS = ["--disable-webgl"];
const MAX_PAGES = 8;
const PAGE_MEMORY_BYTES = 1.5 * 1024 ** 3;
const RESERVED_MEMORY_BYTES = 2 * 1024 ** 3;

export const openPage = async (browser: Browser, url: string): Promise<Page> => {
  for (let attempt = 1; ; attempt++) {
    const page = await browser.newPage();
    let isHarnessLoaded = false;
    const { origin } = new URL(url);
    await page.route("**/*", (route) => {
      const request = route.request();
      const isMainDocument = request.isNavigationRequest() && request.frame() === page.mainFrame();
      const requestUrl = new URL(request.url());
      const isExternal = requestUrl.protocol.startsWith("http") && requestUrl.origin !== origin;
      return (isMainDocument && isHarnessLoaded) || isExternal ? route.abort() : route.continue();
    });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => Boolean(window.__verify), undefined, {
        timeout: HARNESS_LOAD_TIMEOUT_MS,
      });
      isHarnessLoaded = true;
      return page;
    } catch (error) {
      await page.close().catch(() => undefined);
      if (attempt >= MAX_PAGE_ATTEMPTS) throw error;
    }
  }
};

interface VerifyOptions {
  analyzed?: AnalyzedComponent[];
  componentBudgetMs?: number;
  componentNames?: string[];
  onComponent?: (verdict: ComponentVerdict) => void;
  onStart?: (componentName: string) => void;
  setupDirectory?: string | null;
}

interface VerifyReport {
  verdicts: ComponentVerdict[];
  durationMs: number;
}

interface ComponentVerification {
  verdict: ComponentVerdict;
  isPageBroken: boolean;
}

const createFailedVerdict = (component: AnalyzedComponent, error: unknown): ComponentVerdict => {
  const message = getErrorMessage(error).split("\n")[0] ?? "";
  return {
    ...createEmptyVerdict(component.analysis, component.report),
    status: "mount-failed",
    error: message,
    mountFailure: error instanceof HarnessError ? error.failure : classifyMountError(message),
  };
};

const verifyComponent = async (
  page: Page,
  component: AnalyzedComponent,
  harness: ProjectHarness,
  budgetMs: number,
): Promise<ComponentVerification> => {
  try {
    const observations = component.analysis.exportName
      ? await exploreComponent(
          page,
          component.analysis,
          harness.getComponentModule(component.analysis.file),
          harness.projectIndex,
          budgetMs,
        )
      : [];
    return {
      verdict: scoreComponent(
        component.analysis,
        component.report,
        observations,
        harness.knownComponents,
      ),
      isPageBroken: false,
    };
  } catch (error) {
    return {
      verdict: createFailedVerdict(component, error),
      isPageBroken: true,
    };
  }
};

const getPageCount = (componentCount: number): number =>
  Math.max(
    1,
    Math.min(
      MAX_PAGES,
      availableParallelism(),
      Math.floor((process.availableMemory() - RESERVED_MEMORY_BYTES) / PAGE_MEMORY_BYTES),
      componentCount,
    ),
  );

class HarnessPage {
  readonly #browser: Browser;
  readonly #harness: ProjectHarness;
  #page: Page;
  #dependencyHash: string;

  private constructor(browser: Browser, harness: ProjectHarness, page: Page) {
    this.#browser = browser;
    this.#harness = harness;
    this.#page = page;
    this.#dependencyHash = harness.getDependencyHash();
  }

  static async open(browser: Browser, harness: ProjectHarness): Promise<HarnessPage> {
    return new HarnessPage(browser, harness, await openPage(browser, harness.url));
  }

  get page(): Page {
    return this.#page;
  }

  get isStale(): boolean {
    return this.#harness.getDependencyHash() !== this.#dependencyHash;
  }

  async reopen(): Promise<void> {
    await this.close();
    this.#page = await openPage(this.#browser, this.#harness.url);
    this.#dependencyHash = this.#harness.getDependencyHash();
  }

  async close(): Promise<void> {
    await this.#page.close().catch(() => undefined);
  }
}

const verifyOnFreshPage = async (
  harnessPage: HarnessPage,
  component: AnalyzedComponent,
  harness: ProjectHarness,
  budgetMs: number,
): Promise<ComponentVerdict> => {
  if (harnessPage.isStale) await harnessPage.reopen();
  let verification = await verifyComponent(harnessPage.page, component, harness, budgetMs);
  if (harnessPage.isStale) {
    await harnessPage.reopen();
    verification = await verifyComponent(harnessPage.page, component, harness, budgetMs);
  }
  if (verification.isPageBroken) await harnessPage.reopen();
  return verification.verdict;
};

const verifyOnPages = async (
  harness: ProjectHarness,
  components: AnalyzedComponent[],
  options: VerifyOptions,
): Promise<ComponentVerdict[]> => {
  const browser = await chromium.launch({ args: BROWSER_ARGUMENTS });
  const budgetMs = options.componentBudgetMs ?? Number.POSITIVE_INFINITY;
  const verdicts: ComponentVerdict[] = [];
  let nextIndex = 0;
  const verifyRemainingOnOnePage = async (pageIndex: number): Promise<void> => {
    const harnessPage = await HarnessPage.open(browser, harness);
    const shouldStop = (): boolean =>
      pageIndex > 0 && process.availableMemory() < RESERVED_MEMORY_BYTES;
    try {
      while (nextIndex < components.length && !shouldStop()) {
        const index = nextIndex++;
        const component = components[index];
        if (!component) continue;
        options.onStart?.(component.analysis.name);
        const verdict = await verifyOnFreshPage(harnessPage, component, harness, budgetMs);
        verdicts[index] = verdict;
        options.onComponent?.(verdict);
      }
    } finally {
      await harnessPage.close();
    }
  };
  try {
    const pageCount = getPageCount(components.length);
    await Promise.all(
      Array.from({ length: pageCount }, (_, pageIndex) => verifyRemainingOnOnePage(pageIndex)),
    );
  } finally {
    await browser.close();
  }
  return verdicts;
};

export const verifyProject = async (
  tsconfigPath: string,
  options: VerifyOptions = {},
): Promise<VerifyReport> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfigPath);
  const analyzed = options.analyzed ?? analyzeProject(configPath).components;
  const componentNames = options.componentNames;
  const mountable = exposeLocalComponents(
    componentNames
      ? analyzed.filter((component) => componentNames.includes(component.analysis.name))
      : analyzed,
  );
  const { components } = mountable;
  const harness = await startProjectHarness(
    dirname(configPath),
    analyzed,
    components,
    options.setupDirectory ?? null,
    mountable.localNamesByFile,
  );
  try {
    const verdicts = await verifyOnPages(harness, components, options);
    return { verdicts, durationMs: Math.round(performance.now() - startTime) };
  } finally {
    await harness.close();
  }
};
