import {
  _fiberRoots,
  getFiberById,
  getFiberId,
  getRDTHook,
  instrument,
  type FiberRoot,
  type InstrumentationOptions,
  type ReactDevToolsTarget,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { createFiber } from "./fiber-fixture.js";

interface ReplacementScenario {
  event: keyof Pick<
    InstrumentationOptions,
    "onScheduleFiberRoot" | "onCommitFiberRoot" | "onPostCommitFiberRoot" | "onCommitFiberUnmount"
  >;
}

const scenarios: ReplacementScenario[] = [
  { event: "onScheduleFiberRoot" },
  { event: "onCommitFiberRoot" },
  { event: "onPostCommitFiberRoot" },
  { event: "onCommitFiberUnmount" },
];

it.each(scenarios)(
  "finishes the in-flight $event when a previous hook rewires its dispatcher",
  ({ event }) => {
    const target: ReactDevToolsTarget = {};
    const hook = getRDTHook(undefined, target);
    const root: FiberRoot = {
      current: createFiber({ memoizedState: { element: {}, memoizedState: null, next: null } }),
    };
    const fiber = createFiber();
    const alternate = createFiber({ alternate: fiber });
    fiber.alternate = alternate;
    const trace: string[] = [];
    const argumentsSeen: unknown[][] = [];
    const liveness: boolean[] = [];
    let generation = 0;
    let currentIdentifier = -1;
    const failure = new Error("previous hook after rewiring");
    using _reporter = vi
      .spyOn(console, "error")
      .mockImplementation((message: unknown, error: unknown) => {
        trace.push(`report:${message}:${error === failure}`);
        throw new Error("reporter also throws");
      });
    Reflect.set(hook, event, () => {
      trace.push("previous");
      if (generation < 2) {
        const captured = hook[event];
        if (!captured) throw new Error(`Missing ${event} dispatcher`);
        const wrapperGeneration = ++generation;
        Reflect.set(hook, event, (...argumentsList: unknown[]) => {
          trace.push(`wrapper:${wrapperGeneration}`);
          return Reflect.apply(captured, hook, argumentsList);
        });
        using _rewire = instrument({ target });
        trace.push(`rewire:${generation}`);
        throw failure;
      }
    });
    using _listener = instrument({
      target,
      [event]: (...argumentsList: unknown[]) => {
        trace.push("listener");
        argumentsSeen.push(argumentsList);
        liveness.push(getFiberById(currentIdentifier) !== null);
      },
    });
    const argumentsList: unknown[] =
      event === "onCommitFiberUnmount"
        ? [23, alternate]
        : event === "onCommitFiberRoot"
          ? [23, root, 42, true]
          : event === "onScheduleFiberRoot"
            ? [23, root, "children"]
            : [23, root];
    try {
      for (let dispatch = 0; dispatch < 3; dispatch++) {
        currentIdentifier = getFiberId(fiber);
        getFiberId(alternate);
        const dispatcher = hook[event];
        if (!dispatcher) throw new Error(`Missing ${event} dispatcher`);
        Reflect.apply(dispatcher, hook, argumentsList);
        const expected = Array.from(
          { length: dispatch },
          (_, index) => `wrapper:${dispatch - index}`,
        );
        expected.push("previous");
        if (dispatch < 2)
          expected.push(
            `rewire:${dispatch + 1}`,
            "report:Bippy instrumentation encountered an error::true",
          );
        expected.push("listener");
        if (event === "onCommitFiberUnmount") expect(getFiberById(currentIdentifier)).toBeNull();
        if (event === "onCommitFiberRoot") expect(_fiberRoots.has(root)).toBe(true);
        expect(trace.splice(0)).toEqual(expected);
        expect(
          argumentsSeen
            .splice(0)
            .map((received) =>
              received.map((argument, index) => argument === argumentsList[index]),
            ),
        ).toEqual([argumentsList.map(() => true)]);
        expect(liveness.splice(0)).toEqual([true]);
      }
    } finally {
      _listener();
      root.current.memoizedState = { element: null, memoizedState: null, next: null };
      hook.onCommitFiberRoot(23, root, undefined);
      hook.onCommitFiberUnmount(23, fiber);
    }
    expect(_fiberRoots.has(root)).toBe(false);
    expect(getFiberById(currentIdentifier)).toBeNull();
  },
);
