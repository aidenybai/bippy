import { Fragment } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  getFiberById,
  getFiberId,
  getReactWorkTags,
  instrument,
  traverseRenderedFibers,
  type Fiber,
  type FiberRoot,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface PhaseProbeProps {
  name: string;
  value: number;
}

const runPhaseObservers = async (
  hasSecondObserver: boolean,
  rootInput = "object",
): Promise<string[]> => {
  const harness = createRenderHarness();
  const transcript: string[] = [];
  const trace: string[] = [];
  const failure = new Error("render visitor failed");
  let shouldThrow = true;
  const Probe = ({ name, value }: PhaseProbeProps) => jsx("span", { children: `${name}:${value}` });
  const record = (value: string): void => {
    trace.push(value);
    transcript.push(value);
  };
  const getName = (fiber: Fiber): string | null =>
    fiber.type === Probe
      ? String(fiber.memoizedProps.name)
      : fiber.tag === getReactWorkTags().HostRoot
        ? "root"
        : null;
  const visit = (root: FiberRoot, observer: string, isNested = false): void =>
    traverseRenderedFibers(
      rootInput === "fiber" || (rootInput === "mixed" && observer !== "first")
        ? root.current
        : root,
      (fiber, phase) => {
        const name = getName(fiber);
        if (!name || (name === "root" && phase !== "unmount")) return;
        record(`${observer}:${name}:${phase}`);
        if (observer === "first" && name === "a") {
          if (shouldThrow) throw failure;
          if (!isNested) visit(root, "nested", true);
        }
      },
    );
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === failure}`);
    });
  using _first = instrument({ onCommitFiberRoot: (_rendererId, root) => visit(root, "first") });
  using _second = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (hasSecondObserver) visit(root, "second");
    },
  });
  const render = (value: number) =>
    harness.render(
      jsxs(Fragment, {
        children: [jsx(Probe, { name: "a", value }, "a"), jsx(Probe, { name: "b", value }, "b")],
      }),
    );
  await render(0);
  expect(trace.splice(0)).toEqual([
    "first:a:mount",
    "report:Bippy instrumentation encountered an error::true",
    ...(hasSecondObserver ? ["second:a:mount", "second:b:mount"] : []),
  ]);
  const identifiers = getFiberPreorder(harness.getRoot().current)
    .filter((fiber) => fiber.type === Probe)
    .map(getFiberId);
  expect(identifiers).toHaveLength(2);
  shouldThrow = false;
  for (const value of [1, 2, 3]) {
    await render(value);
    expect(trace.splice(0)).toEqual([
      "first:a:update",
      "nested:a:update",
      "nested:b:update",
      "first:b:update",
      ...(hasSecondObserver ? ["second:a:update", "second:b:update"] : []),
    ]);
    const current = getFiberPreorder(harness.getRoot().current).filter(
      (fiber) => fiber.type === Probe,
    );
    expect(current.map(getFiberId)).toEqual(identifiers);
    for (const [index, fiber] of current.entries())
      expect(getFiberById(identifiers[index]) === fiber).toBe(true);
  }
  await harness.render(null);
  expect(trace.splice(0)).toEqual([
    "first:root:unmount",
    ...(hasSecondObserver ? ["second:root:unmount"] : []),
  ]);
  for (const identifier of identifiers) expect(getFiberById(identifier)).toBeNull();
  return transcript;
};

it.each([false, true])(
  "keeps render phases correct after visitor failure and nested inspection, second observer: %s",
  async (hasSecondObserver) => {
    expect(await runPhaseObservers(hasSecondObserver)).toEqual(
      await runPhaseObservers(hasSecondObserver),
    );
  },
);

it.each(
  ["fiber", "mixed"].flatMap((rootInput) =>
    [false, true].map((hasSecondObserver) => ({ rootInput, hasSecondObserver })),
  ),
)(
  "preserves phases across root argument aliases, input $rootInput, second observer $hasSecondObserver",
  async ({ rootInput, hasSecondObserver }) => {
    expect(await runPhaseObservers(hasSecondObserver, rootInput)).toEqual(
      await runPhaseObservers(hasSecondObserver, rootInput),
    );
  },
);
