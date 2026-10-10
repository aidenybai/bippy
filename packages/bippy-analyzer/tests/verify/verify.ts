import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { analyzeProject } from "../../src/symbolic-tree/analyze.ts";
import type { AnalyzedComponent } from "../../src/symbolic-tree/print.ts";
import { DEFAULT_LIMITS, exploreComponent } from "./driver.ts";
import type { ExploreLimits } from "./driver.ts";
import { collectProbes, scoreComponent } from "./score.ts";
import type { ComponentVerdict } from "./score.ts";
import { startHarness } from "./server.ts";

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
  !componentNames || componentNames.includes(component.model.name);

export const verifyProject = async (
  tsconfigPath: string,
  options: VerifyOptions = {},
): Promise<VerifyReport> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfigPath);
  const appDirectory = dirname(configPath);
  const analyzed = options.analyzed ?? analyzeProject(configPath, undefined).components;
  const components = analyzed.filter((component) => isSelected(component, options.componentNames));
  const exported = components.filter(({ model }) => model.exportName);
  const knownComponents = new Map(
    analyzed.map(({ model }) => [model.name, model.displayName ?? model.name]),
  );
  const harness = await startHarness(
    appDirectory,
    exported.flatMap(({ model }) => collectProbes(model)),
    [...new Set(exported.map(({ model }) => model.file))],
  );
  const browser = await chromium.launch();
  const verdicts: ComponentVerdict[] = [];
  try {
    let page = await openPage(browser, harness.url);
    for (const component of components) {
      options.onStart?.(component.model.name);
      let verdict: ComponentVerdict;
      try {
        const observations = component.model.exportName
          ? await exploreComponent(
              page,
              component.model,
              harness.getModuleUrl(component.model.file),
              options.limits ?? DEFAULT_LIMITS,
            )
          : [];
        verdict = scoreComponent(component.model, component.report, observations, knownComponents);
      } catch (error) {
        verdict = {
          ...scoreComponent(component.model, component.report, [], knownComponents),
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
