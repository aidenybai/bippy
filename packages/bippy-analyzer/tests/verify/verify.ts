import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { analyzeProject } from "../../src/core/entrypoint/analyze-project.js";
import type { AnalyzedComponent } from "../../src/core/inference/types.js";
import { DEFAULT_LIMITS, exploreComponent } from "./driver.js";
import type { ExploreLimits } from "./driver.js";
import { collectProbes, scoreComponent } from "./score.js";
import type { ComponentVerdict } from "./score.js";
import { startHarness } from "./server.js";

const MAX_PAGE_RESETS = 3;

const openPage = async (browser: Browser, url: string): Promise<Page> => {
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
      await page.waitForFunction(() => Boolean(window.__verify), undefined, { timeout: 60_000 });
      isHarnessLoaded = true;
      return page;
    } catch (error) {
      await page.close().catch(() => undefined);
      if (attempt >= MAX_PAGE_RESETS) throw error;
    }
  }
};

export interface VerifyOptions {
  analyzed?: AnalyzedComponent[];
  componentNames?: string[];
  limits?: ExploreLimits;
  onComponent?: (verdict: ComponentVerdict) => void;
  onStart?: (componentName: string) => void;
}

export interface VerifyReport {
  components: ComponentVerdict[];
  durationMs: number;
}

const isSelected = (component: AnalyzedComponent, componentNames: string[] | undefined): boolean =>
  !componentNames || componentNames.includes(component.analysis.name);

export const verifyProject = async (
  tsconfigPath: string,
  options: VerifyOptions = {},
): Promise<VerifyReport> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfigPath);
  const appDirectory = dirname(configPath);
  const analyzed = options.analyzed ?? analyzeProject(configPath).components;
  const components = analyzed.filter((component) => isSelected(component, options.componentNames));
  const exported = components.filter(({ analysis }) => analysis.exportName);
  const knownComponents = new Map(
    analyzed.map(({ analysis }) => [analysis.name, analysis.displayName ?? analysis.name]),
  );
  const harness = await startHarness(
    appDirectory,
    exported.flatMap(({ analysis }) => collectProbes(analysis)),
    [...new Set(exported.map(({ analysis }) => analysis.file))],
  );
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
              options.limits ?? DEFAULT_LIMITS,
            )
          : [];
        verdict = scoreComponent(
          component.analysis,
          component.report,
          observations,
          knownComponents,
        );
      } catch (error) {
        verdict = {
          ...scoreComponent(component.analysis, component.report, [], knownComponents),
          status: "mount-failed",
          error: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
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
