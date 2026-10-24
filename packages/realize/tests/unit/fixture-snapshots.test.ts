import { dirname } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_MAX_STATES, formatMermaid } from "../../src/cli/mermaid";
import { DEFAULT_RENDER_DEPTH, formatRenderTree } from "../../src/cli/render-tree";
import { analyzeProject } from "../../src/core/analyze-project";
import { getFixtureConfig } from "./helpers";

const FIXTURE_CONFIG = getFixtureConfig("symbolic-tree");

describe("fixture analysis", () => {
  const { components } = analyzeProject(FIXTURE_CONFIG);
  const rootDirectory = dirname(FIXTURE_CONFIG);
  const cases = components.map((component) => [component.analysis.name, component] as const);

  it.each(cases)("%s keeps its render tree and handlers", (_name, component) => {
    expect(
      formatRenderTree(component, { rootDirectory, maxDepth: DEFAULT_RENDER_DEPTH }),
    ).toMatchSnapshot();
  });

  it.each(cases)(
    "%s keeps its states, transitions and unreachable branches",
    (_name, component) => {
      expect(
        formatMermaid(component, { rootDirectory, maxStates: DEFAULT_MAX_STATES }),
      ).toMatchSnapshot();
    },
  );
});
