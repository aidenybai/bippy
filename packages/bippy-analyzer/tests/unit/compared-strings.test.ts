import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("comparing a string with no known values", () => {
  const project = analyzeFixture("symbolic-tree", "compared-strings.tsx");

  it("lets only one literal match at a time", () => {
    const { report } = getComponent(project, "NavLinks");
    expect(report.states.map((state) => state.conditions)).toEqual([
      ['pathname === "/"'],
      ['pathname !== "/"', 'pathname === "/blog"'],
      ['pathname !== "/"', 'pathname !== "/blog"', 'pathname === "/about"'],
      ['pathname !== "/"', 'pathname !== "/blog"', 'pathname !== "/about"'],
    ]);
  });

  it("forgets the matched literal once the string is set again", () => {
    const { report } = getComponent(project, "CommandInput");
    const [matched] = report.states;
    expect(matched?.conditions).toEqual(['command === "help"']);
    expect(matched?.transitions.flatMap((transition) => transition.targets)).toEqual([0, 1]);
  });
});
