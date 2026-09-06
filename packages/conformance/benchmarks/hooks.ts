import assert from "node:assert/strict";
import type { Fiber, FiberRoot } from "bippy";
import { benchmarkCase, type BenchmarkCase, type BenchmarkContext } from "./harness.js";
import { createHookComponent, type HookFixtureConfiguration } from "./hook-fixtures.js";

const hookKinds: HookFixtureConfiguration["kind"][] = ["state", "custom", "distinct"];

interface RootCapture {
  current: FiberRoot | null;
}

const verifyStateValues =
  (count: number) =>
  (value: unknown): void => {
    assert.ok(Array.isArray(value));
    const pending: unknown[] = [...value];
    const states: number[] = [];
    while (pending.length) {
      const hook = pending.pop();
      assert.ok(
        hook && typeof hook === "object" && "subHooks" in hook && Array.isArray(hook.subHooks),
      );
      if (hook.subHooks.length === 0 && "name" in hook && hook.name === "State") {
        assert.ok("value" in hook && typeof hook.value === "number");
        states.push(hook.value);
      }
      pending.push(...hook.subHooks);
    }
    assert.deepEqual(
      states.sort((first, second) => first - second),
      Array.from({ length: count }, (_, index) => index),
    );
  };

export const createHookBenchmarks = ({
  Bippy,
  Source,
  React,
  ReactDOM,
  ReactDOMClient,
}: BenchmarkContext): BenchmarkCase[] => {
  const cases: BenchmarkCase[] = [];
  for (const count of [1, 16, 128]) {
    for (const kind of hookKinds) {
      const Render = createHookComponent(React, { count, kind });
      const scenario = `${kind}-${count}`;
      let container: HTMLDivElement | undefined;
      let root: ReturnType<typeof ReactDOMClient.createRoot> | undefined;
      let fiber: Fiber | null = null;
      cases.push(
        benchmarkCase(
          `getFiberHooks/${scenario}`,
          ["bippy/source#getFiberHooks"],
          () => {
            assert.ok(fiber);
            return Source.getFiberHooks(fiber);
          },
          verifyStateValues(count),
          {
            units: count,
            prepare: () => {
              if (root) return;
              container = document.createElement("div");
              document.body.appendChild(container);
              root = ReactDOMClient.createRoot(container);
              const capture: RootCapture = { current: null };
              const unsubscribe = Bippy.instrument({
                onCommitFiberRoot: (_rendererId, fiberRoot) => {
                  capture.current = fiberRoot;
                },
              });
              try {
                ReactDOM.flushSync(() => root?.render(React.createElement(Render)));
                assert.ok(capture.current);
                fiber = Bippy.traverseFiber(
                  capture.current.current,
                  (candidate) => candidate.type === Render,
                );
                assert.ok(fiber);
              } finally {
                unsubscribe();
              }
            },
            cleanup: () => {
              ReactDOM.flushSync(() => root?.unmount());
              container?.remove();
              root = undefined;
              fiber = null;
            },
          },
        ),
      );
      cases.push(
        benchmarkCase(
          `inspectHooks/${scenario}`,
          ["bippy/source#inspectHooks"],
          () => Source.inspectHooks(Render, {}),
          verifyStateValues(count),
          { units: count },
        ),
      );
    }
  }
  return cases;
};
