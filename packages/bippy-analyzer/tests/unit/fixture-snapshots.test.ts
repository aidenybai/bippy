import { dirname, resolve } from "node:path";
import picocolors from "picocolors";
import { describe, expect, it } from "vite-plus/test";
import { ALL_VIEWS, DEFAULT_RENDER_DEPTH } from "../../src/cli/constants.js";
import { formatComponent } from "../../src/cli/print.js";
import { analyzeProject } from "../../src/core/entrypoint/analyze-project.js";

const FIXTURE_CONFIG = resolve(import.meta.dirname, "../../fixtures/symbolic-tree/tsconfig.json");

describe("fixture analysis", () => {
  const { components } = analyzeProject(FIXTURE_CONFIG);
  const options = {
    views: new Set(ALL_VIEWS),
    colors: picocolors.createColors(false),
    rootDirectory: dirname(FIXTURE_CONFIG),
    maxDepth: DEFAULT_RENDER_DEPTH,
    isShowingAttributes: false,
  };

  it.each(components.map((component) => [component.analysis.name, component] as const))(
    "%s keeps its states, edges and dead branches",
    (_name, component) => {
      expect(formatComponent(component, options)).toMatchSnapshot();
    },
  );
});
