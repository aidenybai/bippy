import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import type { PatternNode } from "../src/harness/static-pattern.js";
import { COMPONENTS_DIRECTORY, createComponentRenderer } from "./helpers/component-runner.js";

const getHostNames = (nodes: PatternNode[]): string[] =>
  nodes.flatMap((node) =>
    node.kind === "fiber"
      ? [
          ...(node.tag === "HostComponent" && node.name !== null ? [node.name] : []),
          ...getHostNames(node.children),
        ]
      : [],
  );

describe("conditional task scheduling", () => {
  it("does not produce a timer update on paths that never registered the timer", async () => {
    const renderer = await createComponentRenderer();
    const rendered = await renderer.renderComponent(
      join(COMPONENTS_DIRECTORY, "effect-cause-timer-registration.tsx"),
    );
    const stateSpace = enumerateStaticStates(rendered);
    const states = stateSpace.states.map((state) => getHostNames(state.tree));
    expect(states).toEqual(
      expect.arrayContaining([
        ["main", "canvas", "span"],
        ["main", "aside", "span"],
        ["main", "canvas", "strong"],
      ]),
    );
    expect(states).not.toContainEqual(["main", "aside", "strong"]);
    expect(stateSpace.omitted).toBeNull();
  });
});
