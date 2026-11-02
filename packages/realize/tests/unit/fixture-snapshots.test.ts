import { dirname } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatMermaid } from "../../src/cli/mermaid";
import { formatTla } from "../../src/core/model/tla";
import { analyzeProject } from "../../src/core/project/analyze-project";
import { getFixtureConfig } from "./helpers";

const FIXTURE_CONFIG = getFixtureConfig("state-charts");

describe("fixture analysis", async () => {
  const { components } = await analyzeProject(FIXTURE_CONFIG);
  const rootDirectory = dirname(FIXTURE_CONFIG);
  const cases = components.map((component) => [component.analysis.name, component] as const);

  it.each(cases)("%s keeps its state chart and findings", (_name, component) => {
    expect(formatMermaid(component, { rootDirectory })).toMatchSnapshot();
  });

  it.each(cases)("%s keeps its TLA+ module", (_name, component) => {
    expect(formatTla(component.analysis.name, component.model)).toMatchSnapshot();
  });
});
