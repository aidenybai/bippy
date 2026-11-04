import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { analyzeProject } from "../../../src/core/project/analyze-project";
import type { AnalyzedComponent } from "../../../src/core/types";
import {
  createDeclarationKey,
  parseDeclarationKey,
} from "../../../src/core/project/declaration-key";
import type { ComponentModule, ProjectIndex, SourceIndex } from "./types";
import { exploreComponent } from "./driver";
import { collectHandlerCounters } from "./handler-counters";
import { collectMutationCounters } from "./mutation";
import { collectBranchCounters } from "./branch-counters";
import { checkComponent } from "./check";
import { createEmptyVerdict, toMountFailedVerdict } from "./verdicts";
import type { ComponentVerdict } from "./verdicts";
import { HarnessError, classifyMountError, getErrorMessage } from "./reasons";
import { readHarnessSetup } from "./harness/setup";
import { getTopLevelNames, toLocalExportName } from "./harness/local-exports";
import { getCycleImporters } from "./source-index";
import { startHarness } from "./server";
import type { Harness } from "./server";

export interface ProjectHarness extends Harness {
  getComponentModule: (file: string) => ComponentModule;
  projectIndex: ProjectIndex;
}

const createProjectIndex = (
  sourceIndex: SourceIndex,
  analyzed: AnalyzedComponent[],
): ProjectIndex => ({
  ...sourceIndex,
  components: new Map(
    analyzed.flatMap((component) =>
      component.analysis.exportName
        ? [
            [
              createDeclarationKey(component.analysis.file, component.analysis.exportName),
              component.analysis,
            ],
          ]
        : [],
    ),
  ),
  contextSamples: new Map(analyzed.flatMap((component) => [...component.analysis.contextSamples])),
});

interface MountableComponents {
  components: AnalyzedComponent[];
  localNamesByFile: Map<string, string[]>;
}

const exposeLocalComponents = (components: AnalyzedComponent[]): MountableComponents => {
  const topLevelNamesByFile = new Map<string, Set<string>>();
  const localNamesByFile = new Map<string, string[]>();
  const mountable = components.map((component) => {
    const analysis = component.analysis;
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
  const exported = verifiedComponents.filter((component) => component.analysis.exportName);
  const harness = await startHarness(
    appDirectory,
    exported.flatMap((component) => [
      ...collectBranchCounters(component.analysis),
      ...collectMutationCounters(component.analysis),
      ...collectHandlerCounters(component.analysis).map((handlerCounter) => handlerCounter.counter),
    ]),
    [...new Set(exported.map((component) => component.analysis.file))],
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
  return toMountFailedVerdict(
    createEmptyVerdict(component.analysis, component.model),
    message,
    error instanceof HarnessError ? error.failure : classifyMountError(message),
  );
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
      verdict: await checkComponent(component.analysis, component.model, observations),
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
  #isFresh = true;

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

  get isFresh(): boolean {
    return this.#isFresh;
  }

  async reopen(): Promise<void> {
    await this.close();
    this.#page = await openPage(this.#browser, this.#harness.url);
    this.#dependencyHash = this.#harness.getDependencyHash();
    this.#isFresh = true;
  }

  async verify(component: AnalyzedComponent, budgetMs: number): Promise<ComponentVerification> {
    this.#isFresh = false;
    return verifyComponent(this.#page, component, this.#harness, budgetMs);
  }

  async close(): Promise<void> {
    await this.#page.close().catch(() => undefined);
  }
}

const verifyOnFreshPage = async (
  harnessPage: HarnessPage,
  component: AnalyzedComponent,
  budgetMs: number,
): Promise<ComponentVerdict> => {
  const startTime = performance.now();
  if (harnessPage.isStale) await harnessPage.reopen();
  const isOnFreshPage = harnessPage.isFresh;
  let verification = await harnessPage.verify(component, budgetMs);
  if (harnessPage.isStale || (!isOnFreshPage && verification.verdict.status === "mount-failed")) {
    await harnessPage.reopen();
    verification = await harnessPage.verify(component, budgetMs);
  }
  if (verification.isPageBroken) await harnessPage.reopen();
  return { ...verification.verdict, durationMs: Math.round(performance.now() - startTime) };
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
        const verdict = await verifyOnFreshPage(harnessPage, component, budgetMs);
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
  const analyzed = options.analyzed ?? (await analyzeProject(configPath)).components;
  const componentNames = options.componentNames;
  const mountable = exposeLocalComponents(
    componentNames
      ? analyzed.filter((component) => componentNames.includes(component.analysis.name))
      : analyzed,
  );
  const harness = await startProjectHarness(
    dirname(configPath),
    analyzed,
    mountable.components,
    options.setupDirectory ?? null,
    mountable.localNamesByFile,
  );
  try {
    const verdicts = await verifyOnPages(harness, mountable.components, options);
    return { verdicts, durationMs: Math.round(performance.now() - startTime) };
  } finally {
    await harness.close();
  }
};
