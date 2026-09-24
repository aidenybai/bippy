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
  it("keeps native listeners on mutually exclusive paths from dispatching to each other", async () => {
    const renderer = await createComponentRenderer();
    const rendered = await renderer.renderComponent(
      join(COMPONENTS_DIRECTORY, "effect-cause-native-listener.tsx"),
    );
    const stateSpace = enumerateStaticStates(rendered);
    const states = stateSpace.states.map((state) => getHostNames(state.tree));
    expect(rendered.stats.unknownCount).toBe(0);
    expect(states.every((names) => names.filter((name) => name === "section").length === 1)).toBe(
      true,
    );
    expect(states.length).toBeGreaterThan(0);
    expect(stateSpace.omitted).toBeNull();
  });

  it("guards task writes to a store shared with paths that never mount the owner", async () => {
    const renderer = await createComponentRenderer();
    const rendered = await renderer.renderComponent(
      join(COMPONENTS_DIRECTORY, "effect-cause-timer-store.tsx"),
    );
    const stateSpace = enumerateStaticStates(rendered);
    const states = stateSpace.states.map((state) => getHostNames(state.tree));
    expect(states).toContainEqual(["main", "canvas", "strong", "footer"]);
    expect(states).toContainEqual(["main", "aside", "span", "footer"]);
    expect(states.some((names) => names.includes("aside") && names.includes("strong"))).toBe(false);
    expect(stateSpace.omitted).toBeNull();
  });

  it.each(["effect-cause-promise-all.tsx", "effect-cause-promise-adoption.tsx"])(
    "preserves completion values on each settlement path in %s",
    async (fixture) => {
      const renderer = await createComponentRenderer();
      const rendered = await renderer.renderComponent(join(COMPONENTS_DIRECTORY, fixture));
      const stateSpace = enumerateStaticStates(rendered);
      const states = stateSpace.states.map((state) => getHostNames(state.tree));
      expect(states).toEqual(
        expect.arrayContaining([
          ["main", "canvas", "strong"],
          ["main", "aside", "footer"],
        ]),
      );
      expect(states).toHaveLength(4);
      expect(states.some((names) => names.includes("header"))).toBe(false);
      expect(stateSpace.omitted).toBeNull();
    },
  );

  it("cancels the selected handle without allowing both timers to fire", async () => {
    const renderer = await createComponentRenderer();
    const rendered = await renderer.renderComponent(
      join(COMPONENTS_DIRECTORY, "timer-handle-alternatives.tsx"),
    );
    const stateSpace = enumerateStaticStates(rendered);
    const states = stateSpace.states.map((state) => getHostNames(state.tree));
    expect(states).toEqual(
      expect.arrayContaining([
        ["main", "canvas", "section", "footer"],
        ["main", "aside", "header", "nav"],
      ]),
    );
    expect(states).toHaveLength(4);
    expect(states.some((names) => names.includes("header") && names.includes("footer"))).toBe(
      false,
    );
    expect(stateSpace.omitted).toBeNull();
  });

  it.each([
    "effect-cause-timer-registration.tsx",
    "effect-cause-microtask-registration.tsx",
    "effect-cause-promise-registration.tsx",
    "effect-cause-pending-promise-registration.tsx",
    "effect-cause-promise-settlement.tsx",
    "effect-cause-await-registration.tsx",
  ])("does not update paths that never registered the task in %s", async (fixture) => {
    const renderer = await createComponentRenderer();
    const rendered = await renderer.renderComponent(join(COMPONENTS_DIRECTORY, fixture));
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
