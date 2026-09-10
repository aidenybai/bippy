import {
  _fiberRoots,
  getFiberById,
  getFiberId,
  getRDTHook,
  getReactWorkTags,
  instrument,
  type Fiber,
  type FiberRoot,
  type InstrumentationOptions,
  type ReactDevToolsTarget,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { createFiber } from "./fiber-fixture.js";

interface AccessorReplayOptions {
  event:
    | "onCommitFiberRoot"
    | "onCommitFiberUnmount"
    | "onPostCommitFiberRoot"
    | "onScheduleFiberRoot";
  result: "callback" | "undefined" | "throw";
  cancelsOther: boolean;
  hasNested: boolean;
}
interface AccessorEvent {
  root: FiberRoot;
  fiber: Fiber;
  identifiers: number[];
  arguments: unknown[];
}

const runAccessorReplay = ({
  event,
  result,
  cancelsOther,
  hasNested,
}: AccessorReplayOptions): string[] => {
  const target: ReactDevToolsTarget = {};
  const foreignTarget: ReactDevToolsTarget = {};
  const hook = getRDTHook(undefined, target);
  const rendererId = hook.inject({
    version: "19.3.0",
    rendererPackageName: "accessor-replay",
    bundleType: 1,
  });
  const events: AccessorEvent[] = [0, 1, 2].map((index) => {
    const fiber = createFiber({ key: String(index) });
    const alternate = createFiber({ key: String(index) });
    const identifiers = [getFiberId(fiber), getFiberId(alternate)];
    fiber.alternate = alternate;
    alternate.alternate = fiber;
    const root: FiberRoot = {
      current: createFiber({
        tag: getReactWorkTags().HostRoot,
        child: fiber,
        memoizedState: { element: {}, memoizedState: null, next: null },
      }),
    };
    root.current.stateNode = root;
    fiber.return = root.current;
    alternate.return = root.current;
    return {
      root,
      fiber,
      identifiers,
      arguments:
        event === "onCommitFiberRoot"
          ? [rendererId, root, index + 1, index === 1]
          : event === "onCommitFiberUnmount"
            ? [rendererId, fiber]
            : event === "onScheduleFiberRoot"
              ? [rendererId, root, `children:${index}`]
              : [rendererId, root],
    };
  });
  const trace: string[] = [];
  const transcript: string[] = [];
  const getterFailure = new Error("callback accessor failed");
  const callbackFailure = new Error("captured callback failed");
  const reporterFailure = new Error("accessor reporter failed");
  let activeIndex = -1;
  const getState = (): string => {
    const alive = events
      .flatMap((entry) =>
        entry.identifiers.map((identifier) => Number(getFiberById(identifier) !== null)),
      )
      .join("");
    const roots = events.map((entry) => Number(_fiberRoots.has(entry.root))).join("");
    const isCurrent = events.every((entry) =>
      entry.identifiers.every((identifier) => {
        const current = getFiberById(identifier);
        return current === null || current === entry.fiber;
      }),
    );
    return `${alive}:${roots}:${isCurrent}`;
  };
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getCallback = (label: string, options: InstrumentationOptions) =>
    new Proxy(() => {}, {
      apply: (_callback, receiver, receivedArguments) => {
        const expectedArguments = events[activeIndex]?.arguments ?? [];
        const isValid =
          receivedArguments.length === expectedArguments.length &&
          receivedArguments.every((argument, index) => argument === expectedArguments[index]);
        record(`call:${label}:${activeIndex}:${receiver === options}:${isValid}:${getState()}`);
        if (label === "captured" || label === "replacement") throw callbackFailure;
      },
    });
  const defineGetter = (
    options: InstrumentationOptions,
    label: string,
    read: () => unknown,
  ): void => {
    Object.defineProperty(options, event, {
      configurable: true,
      get: new Proxy(read, {
        apply: (_getter, receiver) => {
          record(`get:${label}:${activeIndex}:${receiver === options}:${getState()}`);
          return read();
        },
      }),
    });
  };
  const getOptions = (label: string, sourceTarget = target): InstrumentationOptions => {
    const options: InstrumentationOptions = { target: sourceTarget };
    const callback = getCallback(label, options);
    defineGetter(options, label, () => callback);
    return options;
  };
  const emit = (index: number): void => {
    const previousIndex = activeIndex;
    activeIndex = index;
    const entry = events[index];
    try {
      if (event === "onCommitFiberRoot")
        hook.onCommitFiberRoot(rendererId, entry.root, index + 1, index === 1);
      else if (event === "onCommitFiberUnmount") hook.onCommitFiberUnmount(rendererId, entry.fiber);
      else if (event === "onPostCommitFiberRoot")
        hook.onPostCommitFiberRoot(rendererId, entry.root);
      else hook.onScheduleFiberRoot?.(rendererId, entry.root, `children:${index}`);
    } catch (error) {
      record(`escape:${index}:${error === getterFailure}:${getState()}`);
    } finally {
      activeIndex = previousIndex;
    }
  };
  let unsubscribeChanging = () => {};
  let unsubscribeOther = () => {};
  let unsubscribeAdded = () => {};
  const changingOptions: InstrumentationOptions = { target };
  const captured = getCallback("captured", changingOptions);
  const replacement = getCallback("replacement", changingOptions);
  const otherOptions = getOptions("other");
  const addedOptions = getOptions("added");
  defineGetter(changingOptions, "changing", () => {
    Object.defineProperty(changingOptions, event, {
      value: replacement,
      writable: true,
      configurable: true,
    });
    if (cancelsOther) unsubscribeOther();
    unsubscribeAdded = instrument(addedOptions);
    if (cancelsOther) unsubscribeOther = instrument(otherOptions);
    if (hasNested) emit(1);
    if (result === "throw") throw getterFailure;
    return result === "undefined" ? undefined : captured;
  });
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(
        `report:${activeIndex}:${message}:${error === getterFailure ? "getter" : error === callbackFailure ? "callback" : "unknown"}:${getState()}`,
      );
      throw reporterFailure;
    });
  using _foreign = instrument(getOptions("foreign", foreignTarget));
  unsubscribeChanging = instrument(changingOptions);
  unsubscribeOther = instrument(otherOptions);
  using unsubscribeLast = instrument(getOptions("last"));
  const state = (alive: string, roots: string): string =>
    `${alive}:${event === "onCommitFiberRoot" ? roots : "000"}:true`;
  const get = (label: string, index: number, snapshot: string): string =>
    `get:${label}:${index}:true:${snapshot}`;
  const call = (label: string, index: number, snapshot: string): string =>
    `call:${label}:${index}:true:true:${snapshot}`;
  const report = (index: number, failure: string, snapshot: string): string =>
    `report:${index}:Bippy instrumentation encountered an error::${failure}:${snapshot}`;
  const observer = (label: string, index: number, snapshot: string): string[] => [
    get(label, index, snapshot),
    call(label, index, snapshot),
  ];
  const remainingOrder = cancelsOther ? ["last", "added", "other"] : ["other", "last", "added"];
  try {
    expect(trace).toEqual([]);
    emit(0);
    const initial = state("111111", "100");
    const nested = state("111111", "110");
    const afterNested = state(
      event === "onCommitFiberUnmount" && hasNested ? "110011" : "111111",
      hasNested ? "110" : "100",
    );
    expect(trace.splice(0)).toEqual([
      get("changing", 0, initial),
      ...(hasNested
        ? [
            call("replacement", 1, nested),
            report(1, "callback", nested),
            ...remainingOrder.flatMap((label) => observer(label, 1, nested)),
          ]
        : []),
      ...(result === "callback" ? [call("captured", 0, afterNested)] : []),
      ...(result === "undefined"
        ? []
        : [report(0, result === "throw" ? "getter" : "callback", afterNested)]),
      ...(cancelsOther ? [] : observer("other", 0, afterNested)),
      ...observer("last", 0, afterNested),
    ]);
    const beforeLater =
      event === "onCommitFiberUnmount" ? (hasNested ? "000011" : "001111") : "111111";
    expect(getState()).toBe(state(beforeLater, hasNested ? "110" : "100"));
    emit(2);
    const later = state(beforeLater, hasNested ? "111" : "101");
    expect(trace.splice(0)).toEqual([
      call("replacement", 2, later),
      report(2, "callback", later),
      ...remainingOrder.flatMap((label) => observer(label, 2, later)),
    ]);
    expect(getState()).toBe(
      state(
        event === "onCommitFiberUnmount" ? (hasNested ? "000000" : "001100") : "111111",
        hasNested ? "111" : "101",
      ),
    );
    return [...transcript];
  } finally {
    unsubscribeChanging();
    unsubscribeOther();
    unsubscribeAdded();
    unsubscribeLast();
    for (const entry of events) {
      hook.onCommitFiberUnmount(rendererId, entry.fiber);
      entry.root.current.memoizedState = { element: null, memoizedState: null, next: null };
      hook.onCommitFiberRoot(rendererId, entry.root, 0, false);
      expect(_fiberRoots.has(entry.root)).toBe(false);
      for (const identifier of entry.identifiers) expect(getFiberById(identifier)).toBeNull();
    }
  }
};

const accessorEvents: AccessorReplayOptions["event"][] = [
  "onCommitFiberRoot",
  "onCommitFiberUnmount",
  "onPostCommitFiberRoot",
  "onScheduleFiberRoot",
];
const accessorResults: AccessorReplayOptions["result"][] = ["callback", "undefined", "throw"];
it.each(
  accessorEvents.flatMap((event) =>
    accessorResults.flatMap((result) =>
      [false, true].flatMap((cancelsOther) =>
        [false, true].map((hasNested) => ({ event, result, cancelsOther, hasNested })),
      ),
    ),
  ),
)(
  "captures $event accessor, result $result, replaces sibling $cancelsOther, nested $hasNested",
  (options) => {
    expect(runAccessorReplay(options)).toEqual(runAccessorReplay(options));
  },
);
