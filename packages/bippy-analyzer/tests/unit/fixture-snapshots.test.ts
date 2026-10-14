import { dirname } from "node:path";
import picocolors from "picocolors";
import { describe, expect, it } from "vite-plus/test";
import { ALL_VIEWS, DEFAULT_RENDER_DEPTH, formatComponent } from "../../src/cli/print";
import { analyzeProject } from "../../src/core/analyze-project";
import { getFixtureConfig } from "./helpers";

const FIXTURE_CONFIG = getFixtureConfig("symbolic-tree");

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
    "%s keeps its states, transitions and unreachable branches",
    (_name, component) => {
      expect(formatComponent(component, options)).toMatchSnapshot();
    },
  );
});
