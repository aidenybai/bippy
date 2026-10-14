import { availableParallelism, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { analyzeProject } from "../../../src/core/analyze-project";
import type { AnalyzedComponent } from "../../../src/core/types";
import { createDeclarationKey } from "../../../src/core/utils/declaration-key";
import type { ComponentModule, ProjectIndex } from "./types";
import { exploreComponent } from "./driver";
import { collectMutationProbes } from "./mutation";
import { collectProbes, scoreComponent } from "./score";
import type { ComponentVerdict } from "./score";
import { HarnessError, classifyMountError } from "./reasons";
import { readHarnessSetup } from "./harness/setup";
import { getCycleImporters } from "./source-index";
import { startHarness } from "./server";
import type { Harness } from "./server";

export interface ProjectHarness extends Harness {
  getComponentModule: (file: string) => ComponentModule;
  knownComponents: Map<string, string>;
  projectIndex: ProjectIndex;
}

export const startProjectHarness = async (
  appDirectory: string,
  analyzed: AnalyzedComponent[],
  mounted: AnalyzedComponent[],
  setupDirectory: string | null,
): Promise<ProjectHarness> => {
  const exported = mounted.filter(({ analysis }) => analysis.exportName);
  const harness = await startHarness(
    appDirectory,
    exported.flatMap(({ analysis }) => [
      ...collectProbes(analysis),
      ...collectMutationProbes(analysis),
    ]),
    [...new Set(exported.map(({ analysis }) => analysis.file))],
    readHarnessSetup(setupDirectory),
  );
  const cycleImporters = getCycleImporters(harness.sourceIndex.imports);
  return {
    ...harness,
    getComponentModule: (file) => ({
      url: harness.getModuleUrl(file),
      importerUrls: (cycleImporters.get(file) ?? []).map(harness.getModuleUrl),
    }),
    projectIndex: {
      ...harness.sourceIndex,
      components: new Map(
        analyzed.flatMap(({ analysis }) =>
          analysis.exportName
            ? [[createDeclarationKey(analysis.file, analysis.exportName), analysis]]
            : [],
        ),
      ),
      contextSamples: new Map(analyzed.flatMap(({ analysis }) => [...analysis.contextSamples])),
    },
    knownComponents: new Map(
      analyzed.flatMap(({ analysis }) =>
        analysis.runtimeName ? [[analysis.declaration, analysis.runtimeName]] : [],
      ),
    ),
  };
};

const MAX_PAGE_ATTEMPTS = 3;
const HARNESS_LOAD_TIMEOUT_MS = 60_000;
const MAX_PAGES = 8;
const PAGE_MEMORY_BYTES = 1.5 * 1024 ** 3;
const RESERVED_MEMORY_BYTES = 5 * 1024 ** 3;

// HACK: retries flaky harness loads, and aborts external requests and post-load navigations so no
// component hangs on the network.
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
  componentNames?: string[];
  onComponent?: (verdict: ComponentVerdict) => void;
  onStart?: (componentName: string) => void;
  setupDirectory?: string | null;
}

interface VerifyReport {
  components: ComponentVerdict[];
  durationMs: number;
}

interface ComponentVerification {
  verdict: ComponentVerdict;
  isPageBroken: boolean;
}

const createFailedVerdict = (
  component: AnalyzedComponent,
  error: unknown,
  knownComponents: Map<string, string>,
): ComponentVerdict => {
  const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
  return {
    ...scoreComponent(component.analysis, component.report, [], knownComponents),
    status: "mount-failed",
    error: message,
    mountFailure: error instanceof HarnessError ? error.failure : classifyMountError(message),
  };
};

const verifyComponent = async (
  page: Page,
  component: AnalyzedComponent,
  harness: ProjectHarness,
): Promise<ComponentVerification> => {
  try {
    const observations = component.analysis.exportName
      ? await exploreComponent(
          page,
          component.analysis,
          harness.getComponentModule(component.analysis.file),
          harness.projectIndex,
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
      verdict: createFailedVerdict(component, error, harness.knownComponents),
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
      Math.floor((totalmem() - RESERVED_MEMORY_BYTES) / PAGE_MEMORY_BYTES),
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
): Promise<ComponentVerdict> => {
  if (harnessPage.isStale) await harnessPage.reopen();
  let verification = await verifyComponent(harnessPage.page, component, harness);
  if (harnessPage.isStale) {
    await harnessPage.reopen();
    verification = await verifyComponent(harnessPage.page, component, harness);
  }
  if (verification.isPageBroken) await harnessPage.reopen();
  return verification.verdict;
};

export const verifyProject = async (
  tsconfigPath: string,
  options: VerifyOptions = {},
): Promise<VerifyReport> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfigPath);
  const analyzed = options.analyzed ?? analyzeProject(configPath).components;
  const componentNames = options.componentNames;
  const components = componentNames
    ? analyzed.filter((component) => componentNames.includes(component.analysis.name))
    : analyzed;
  const harness = await startProjectHarness(
    dirname(configPath),
    analyzed,
    components,
    options.setupDirectory ?? null,
  );
  const browser = await chromium.launch();
  const verdicts: ComponentVerdict[] = [];
  let nextIndex = 0;
  const verifyRemainingOnOnePage = async (): Promise<void> => {
    const harnessPage = await HarnessPage.open(browser, harness);
    try {
      for (let index = nextIndex++; index < components.length; index = nextIndex++) {
        const component = components[index];
        if (!component) continue;
        options.onStart?.(component.analysis.name);
        const verdict = await verifyOnFreshPage(harnessPage, component, harness);
        verdicts[index] = verdict;
        options.onComponent?.(verdict);
      }
    } finally {
      await harnessPage.close();
    }
  };
  try {
    const pageCount = getPageCount(components.length);
    await Promise.all(Array.from({ length: pageCount }, verifyRemainingOnOnePage));
  } finally {
    await browser.close();
    await harness.close();
  }
  return { components: verdicts, durationMs: Math.round(performance.now() - startTime) };
};
