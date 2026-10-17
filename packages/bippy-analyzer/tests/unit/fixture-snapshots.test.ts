import { dirname } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_MAX_STATES, formatMermaid } from "../../src/cli/mermaid";
import { analyzeProject } from "../../src/core/analyze-project";
import { getFixtureConfig } from "./helpers";

const FIXTURE_CONFIG = getFixtureConfig("symbolic-tree");

describe("fixture analysis", () => {
  const { components } = analyzeProject(FIXTURE_CONFIG);
  const options = { rootDirectory: dirname(FIXTURE_CONFIG), maxStates: DEFAULT_MAX_STATES };

  it.each(components.map((component) => [component.analysis.name, component] as const))(
    "%s keeps its states, transitions and unreachable branches",
    (_name, component) => {
      expect(formatMermaid(component, options)).toMatchSnapshot();
    },
  );
});
