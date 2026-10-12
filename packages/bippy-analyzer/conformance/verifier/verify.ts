import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { analyzeProject } from "../../src/core/analyze-project.js";
import type { AnalyzedComponent } from "../../src/core/types.js";
import type { ProjectIndex } from "./types.js";
import { exploreComponent } from "./driver.js";
import { collectMutationProbes } from "./mutation.js";
import { collectProbes, scoreComponent } from "./score.js";
import type { ComponentVerdict } from "./score.js";
import { classifyMountError } from "./reasons.js";
import { readHarnessSetup, startHarness } from "./server.js";
import type { Harness } from "./server.js";

export interface ProjectHarness extends Harness {
  knownComponents: Map<string, string>;
  projectIndex: ProjectIndex;
}

/**
 * Starts the harness for a project: probes on the components it will mount, the runtime
 * name of every component so a render can be matched by declaration, and an index of the
 * project's exports to find parents in.
 */
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
  return {
    ...harness,
    projectIndex: {
      ...harness.sourceIndex,
      components: new Map(
        analyzed.flatMap(({ analysis }) =>
          analysis.exportName ? [[`${analysis.file}#${analysis.exportName}`, analysis]] : [],
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

/**
 * Opens a harness page. It never leaves the harness: navigations after it loads and
 * requests to any other origin fail, so no component waits on the internet.
 */
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

export const verifyProject = async (
  tsconfigPath: string,
  options: VerifyOptions = {},
): Promise<VerifyReport> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfigPath);
  const appDirectory = dirname(configPath);
  const analyzed = options.analyzed ?? analyzeProject(configPath).components;
  const { componentNames } = options;
  const components = componentNames
    ? analyzed.filter(({ analysis }) => componentNames.includes(analysis.name))
    : analyzed;
  const harness = await startProjectHarness(
    appDirectory,
    analyzed,
    components,
    options.setupDirectory ?? null,
  );
  const { knownComponents } = harness;
  const browser = await chromium.launch();
  const verdicts: ComponentVerdict[] = [];
  const verifyComponent = async (
    page: Page,
    component: AnalyzedComponent,
  ): Promise<{ verdict: ComponentVerdict; isPageBroken: boolean }> => {
    try {
      const observations = component.analysis.exportName
        ? await exploreComponent(
            page,
            component.analysis,
            harness.getModuleUrl(component.analysis.file),
            harness.projectIndex,
          )
        : [];
      return {
        verdict: scoreComponent(
          component.analysis,
          component.report,
          observations,
          knownComponents,
        ),
        isPageBroken: false,
      };
    } catch (error) {
      const message = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
      return {
        verdict: {
          ...scoreComponent(component.analysis, component.report, [], knownComponents),
          status: "mount-failed",
          error: message,
          mountFailure: classifyMountError(message),
        },
        isPageBroken: true,
      };
    }
  };
  let nextIndex = 0;
  const runPage = async (): Promise<void> => {
    let page = await openPage(browser, harness.url);
    let pageDependencyHash = harness.getDependencyHash();
    const reopenPage = async (): Promise<void> => {
      await page.close().catch(() => undefined);
      page = await openPage(browser, harness.url);
      pageDependencyHash = harness.getDependencyHash();
    };
    const isPageStale = (): boolean => harness.getDependencyHash() !== pageDependencyHash;
    try {
      for (let index = nextIndex++; index < components.length; index = nextIndex++) {
        const component = components[index];
        if (!component) continue;
        options.onStart?.(component.analysis.name);
        if (isPageStale()) await reopenPage();
        let result = await verifyComponent(page, component);
        if (isPageStale()) {
          await reopenPage();
          result = await verifyComponent(page, component);
        }
        if (result.isPageBroken) await reopenPage();
        verdicts[index] = result.verdict;
        options.onComponent?.(result.verdict);
      }
    } finally {
      await page.close().catch(() => undefined);
    }
  };
  try {
    const pageCount = Math.min(MAX_PAGES, availableParallelism(), components.length);
    await Promise.all(Array.from({ length: pageCount }, runPage));
  } finally {
    await browser.close();
    await harness.close();
  }
  return { components: verdicts, durationMs: Math.round(performance.now() - startTime) };
};
