import assert from "node:assert/strict";
import type { FiberRoot } from "bippy";
import { benchmarkCase, type BenchmarkCase, type BenchmarkContext } from "./harness.js";

interface RootCapture {
  current: FiberRoot | null;
}

const verifyStateCount =
  (count: number) =>
  (value: unknown): void => {
    assert.ok(Array.isArray(value));
    const pending: unknown[] = [...value];
    let states = 0;
    while (pending.length) {
      const hook = pending.pop();
      assert.ok(hook && typeof hook === "object");
      const subHooks: unknown = Reflect.get(hook, "subHooks");
      assert.ok(Array.isArray(subHooks));
      if (subHooks.length === 0 && Reflect.get(hook, "name") === "State") states++;
      pending.push(...subHooks);
    }
    assert.equal(states, count);
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
    for (const kind of ["state", "custom", "distinct"]) {
      const distinctRender: unknown =
        kind === "distinct"
          ? new Function(
              "React",
              `return () => {\n${Array.from({ length: count }, (_, index) => `React.useState(${index});`).join("\n")}\nreturn null;\n}`,
            )(React)
          : null;
      const useBenchValue = (index: number) => {
        const [value] = React.useState(index);
        React.useRef(value);
        return React.useMemo(() => value, [value]);
      };
      const Render = () => {
        if (typeof distinctRender === "function")
          return Reflect.apply(distinctRender, undefined, []);
        for (let index = 0; index < count; index++) {
          if (kind === "custom") useBenchValue(index);
          else React.useState(index);
        }
        return null;
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient.createRoot(container);
      const capture: RootCapture = { current: null };
      const unsubscribe = Bippy.instrument({
        onCommitFiberRoot: (_rendererId, fiberRoot) => {
          capture.current = fiberRoot;
        },
      });
      ReactDOM.flushSync(() => root.render(React.createElement(Render)));
      unsubscribe();
      assert.ok(capture.current);
      const fiber = Bippy.traverseFiber(
        capture.current.current,
        (candidate) => candidate.type === Render,
      );
      assert.ok(fiber);
      const scenario = `${kind}-${count}`;
      cases.push(
        benchmarkCase(
          `getFiberHooks/${scenario}`,
          ["bippy/source#getFiberHooks"],
          () => Source.getFiberHooks(fiber),
          verifyStateCount(count),
          {
            units: count,
            cleanup: () => {
              ReactDOM.flushSync(() => root.unmount());
              container.remove();
            },
          },
        ),
      );
      cases.push(
        benchmarkCase(
          `inspectHooks/${scenario}`,
          ["bippy/source#inspectHooks"],
          () => Source.inspectHooks(Render, {}),
          verifyStateCount(count),
          { units: count },
        ),
      );
    }
  }
  return cases;
};
