import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { analyzeProject } from "../../src/core/analyze-project.js";
import type { AnalyzedComponent } from "../../src/core/types.js";
import { exploreComponent } from "./driver.js";
import { collectMutationProbes } from "./mutation.js";
import { collectProbes, scoreComponent } from "./score.js";
import type { ComponentVerdict } from "./score.js";
import { classifyMountError } from "./reasons.js";
import { readHarnessSetup, startHarness } from "./server.js";
import type { Harness } from "./server.js";

export interface ProjectHarness extends Harness {
  knownComponents: Map<string, string>;
}

/**
 * Starts the harness for a project: probes on the components it will mount, and the
 * runtime name of every component so a render can be matched by declaration.
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
    knownComponents: new Map(
      analyzed.flatMap(({ analysis }) =>
        analysis.runtimeName ? [[analysis.declaration, analysis.runtimeName]] : [],
      ),
    ),
  };
};

const MAX_PAGE_ATTEMPTS = 3;
const HARNESS_LOAD_TIMEOUT_MS = 60_000;

export const openPage = async (browser: Browser, url: string): Promise<Page> => {
  for (let attempt = 1; ; attempt++) {
    const page = await browser.newPage();
    let isHarnessLoaded = false;
    await page.route("**/*", (route) => {
      const request = route.request();
      const isMainDocument = request.isNavigationRequest() && request.frame() === page.mainFrame();
      return isMainDocument && isHarnessLoaded ? route.abort() : route.continue();
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
  try {
    let page = await openPage(browser, harness.url);
    for (const component of components) {
      options.onStart?.(component.analysis.name);
      let verdict: ComponentVerdict;
      try {
        const observations = component.analysis.exportName
          ? await exploreComponent(
              page,
              component.analysis,
              harness.getModuleUrl(component.analysis.file),
              harness.exportIndex,
            )
          : [];
        verdict = scoreComponent(
          component.analysis,
          component.report,
          observations,
          knownComponents,
        );
      } catch (error) {
        const message =
          error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
        verdict = {
          ...scoreComponent(component.analysis, component.report, [], knownComponents),
          status: "mount-failed",
          error: message,
          mountFailure: classifyMountError(message),
        };
        await page.close().catch(() => undefined);
        page = await openPage(browser, harness.url);
      }
      verdicts.push(verdict);
      options.onComponent?.(verdict);
    }
  } finally {
    await browser.close();
    await harness.close();
  }
  return { components: verdicts, durationMs: Math.round(performance.now() - startTime) };
};
