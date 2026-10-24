import { createRequire } from "node:module";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Browser, Page } from "playwright";
import { formatMermaid } from "../../src/cli/mermaid";
import { DEFAULT_RENDER_DEPTH, formatRenderTree } from "../../src/cli/render-tree";
import { analyzeProject } from "../../src/core/analyze-project";
import { getFixtureConfig } from "./helpers";

const MERMAID_SCRIPT = createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js");
const FIXTURES = ["symbolic-tree", "conformance-repros"];
const SMALL_DIAGRAM_STATES = 3;

declare const mermaid: {
  initialize: (config: object) => void;
  parse: (text: string) => Promise<unknown>;
};

const parseInBrowser = async (page: Page, diagram: string): Promise<string | null> =>
  page.evaluate(async (text) => {
    try {
      await mermaid.parse(text);
      return null;
    } catch (error) {
      return String(error);
    }
  }, diagram);

describe("mermaid output", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent("<html><body></body></html>");
    await page.addScriptTag({ path: MERMAID_SCRIPT });
    await page.evaluate(() => mermaid.initialize({ startOnLoad: false }));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each(FIXTURES)(
    "parses as a render tree and a state diagram for every component in %s",
    async (fixture) => {
      const config = getFixtureConfig(fixture);
      const { components } = analyzeProject(config);
      const rootDirectory = dirname(config);
      for (const component of components) {
        const diagrams = [
          formatRenderTree(component, { rootDirectory, maxDepth: DEFAULT_RENDER_DEPTH }),
          formatMermaid(component, { rootDirectory, maxStates: SMALL_DIAGRAM_STATES }),
        ];
        for (const diagram of diagrams)
          expect.soft(await parseInBrowser(page, diagram), diagram).toBeNull();
      }
    },
    120_000,
  );
});
