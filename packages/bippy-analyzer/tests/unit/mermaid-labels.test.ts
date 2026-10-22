import { dirname } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_MAX_STATES, formatMermaid } from "../../src/cli/mermaid";
import { analyzeFixture, getComponent, getFixtureConfig } from "./helpers";

describe("Mermaid state labels", () => {
  const project = analyzeFixture("conformance-repros", "mermaid-labels");
  const rootDirectory = dirname(getFixtureConfig("conformance-repros"));

  it("escapes colons in descriptions and transition labels", () => {
    const diagram = formatMermaid(getComponent(project, "ColonText"), {
      rootDirectory,
      maxStates: DEFAULT_MAX_STATES,
    });
    const stateLines = diagram.split("\n").filter((line) => /^\s+S\d+: /.test(line));
    expect(stateLines).toHaveLength(2);
    expect(stateLines.join("\n")).toContain('"time#58; 12#58;30"');
    for (const line of stateLines) expect(line.replace(/^\s+S\d+: /, "")).not.toContain(":");
    expect(diagram).toContain('"save#58; now"');
  });

  it("labels a provided setter by its own value, not a sibling button's text", () => {
    const diagram = formatMermaid(getComponent(project, "ProviderBesideButton"), {
      rootDirectory,
      maxStates: DEFAULT_MAX_STATES,
    });
    const transitionLines = diagram.split("\n").filter((line) => /^\s+S\d+ --> S\d+: /.test(line));
    expect(transitionLines).toHaveLength(2);
    for (const line of transitionLines) expect(line).toMatch(/: set isOpen$/);
  });
});
