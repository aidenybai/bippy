import {
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  getReactWorkTags,
  instrument,
  type Fiber,
  type FiberRoot,
  type ReactDevToolsTarget,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { createFiber, getFiberPreorder, linkChildren } from "./fiber-fixture.js";

interface UnmountCurrentFixture {
  root: FiberRoot;
  fibers: Fiber[];
  identifier: number;
  current: Fiber;
  restoreTree: () => void;
  getScanReads: () => number;
  resetScanReads: () => void;
}
interface UnmountCurrentOptions {
  crossesReturns: boolean;
  hasNested: boolean;
  assignedIndex: number;
}

const createUnmountFixture = (
  crossesReturns: boolean,
  assignedIndex: number,
): UnmountCurrentFixture => {
  const tags = getReactWorkTags();
  const roots = [0, 1].map(() => createFiber({ tag: tags.HostRoot }));
  const boundaries = [0, 1].map(() => createFiber({ tag: tags.SuspenseComponent }));
  const primaries = [0, 1].map(() => createFiber({ tag: tags.OffscreenComponent }));
  const fallbacks = [0, 1].map(() => createFiber({ tag: tags.Fragment }));
  const fibers = [0, 1].map((value) =>
    createFiber({ memoizedState: { value, next: null, memoizedState: null } }),
  );
  const root: FiberRoot = { current: roots[0] };
  for (const pair of [roots, boundaries, primaries, fallbacks, fibers]) {
    pair[0].alternate = pair[1];
    pair[1].alternate = pair[0];
  }
  for (const index of [0, 1]) {
    roots[index].stateNode = root;
    linkChildren(roots[index], [boundaries[index]]);
    linkChildren(boundaries[index], [primaries[index], fallbacks[index]]);
    linkChildren(fallbacks[index], [fibers[index]]);
  }
  if (crossesReturns) {
    primaries[0].sibling = fallbacks[1];
    primaries[1].sibling = null;
  }
  let scanReads = 0;
  Object.defineProperty(primaries[0], "child", {
    get: () => {
      scanReads++;
      return null;
    },
  });
  return {
    root,
    fibers,
    identifier: getFiberId(fibers[assignedIndex]),
    current: fibers[crossesReturns ? 1 : 0],
    restoreTree: () => {
      primaries[0].sibling = fallbacks[0];
      primaries[1].sibling = fallbacks[1];
    },
    getScanReads: () => scanReads,
    resetScanReads: () => {
      scanReads = 0;
    },
  };
};

const runUnmountCurrent = ({
  crossesReturns,
  hasNested,
  assignedIndex,
}: UnmountCurrentOptions): string[] => {
  const outer = createUnmountFixture(crossesReturns, assignedIndex);
  const inner = createUnmountFixture(true, 1 - assignedIndex);
  const target: ReactDevToolsTarget = {};
  const hook = getRDTHook(undefined, target);
  const rendererId = hook.inject({
    version: "19.3.0",
    rendererPackageName: "unmount-current",
    bundleType: 1,
  });
  const trace: string[] = [];
  const previousFailure = new Error("previous unmount failed");
  const observerFailure = new Error("nested unmount observer failed");
  const reporterFailure = new Error("unmount reporter failed");
  const getFixture = (fiber: Fiber): UnmountCurrentFixture =>
    fiber === outer.fibers[1] ? outer : inner;
  const record = (
    label: string,
    fixture: UnmountCurrentFixture,
    receivedRenderer: number,
  ): void => {
    const current = getFiberPreorder(fixture.root.current).find((candidate) =>
      fixture.fibers.includes(candidate),
    );
    trace.push(
      `${label}:${fixture === outer ? "outer" : "inner"}:${receivedRenderer === rendererId}:${getFiberById(fixture.identifier) === current}:${getLatestFiber(fixture.fibers[0]) === current}:${getLatestFiber(fixture.fibers[1]) === current}:${getFiberById(outer.identifier) !== null}:${getFiberById(inner.identifier) !== null}`,
    );
  };
  hook.onCommitFiberUnmount = (receivedRenderer, fiber) => {
    record("previous", getFixture(fiber), receivedRenderer);
    throw previousFailure;
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      trace.push(
        `report:${message}:${error === previousFailure ? "previous" : error === observerFailure ? "observer" : "unknown"}`,
      );
      throw reporterFailure;
    });
  using unsubscribeFirst = instrument({
    target,
    onCommitFiberUnmount: (receivedRenderer, fiber) => {
      const fixture = getFixture(fiber);
      record("first", fixture, receivedRenderer);
      if (fixture === outer && hasNested) {
        hook.onCommitFiberUnmount(rendererId, inner.fibers[1]);
        record("resumed", outer, receivedRenderer);
      }
      throw observerFailure;
    },
  });
  using unsubscribeSecond = instrument({
    target,
    onCommitFiberUnmount: (receivedRenderer, fiber) =>
      record("second", getFixture(fiber), receivedRenderer),
  });
  const entry = (label: string, name: string, isInnerLive = true): string =>
    `${label}:${name}:true:true:true:true:true:${isInnerLive}`;
  const report = (name: string): string =>
    `report:Bippy instrumentation encountered an error::${name}`;
  try {
    expect(getFiberPreorder(outer.root.current)).toContain(outer.current);
    expect(getFiberPreorder(inner.root.current)).toContain(inner.current);
    hook.onCommitFiberUnmount(rendererId, outer.fibers[1]);
    expect(trace).toEqual([
      entry("previous", "outer"),
      report("previous"),
      entry("first", "outer"),
      ...(hasNested
        ? [
            entry("previous", "inner"),
            report("previous"),
            entry("first", "inner"),
            report("observer"),
            entry("second", "inner"),
            entry("resumed", "outer", false),
          ]
        : []),
      report("observer"),
      entry("second", "outer", !hasNested),
    ]);
    expect(getFiberById(outer.identifier)).toBeNull();
    expect(getFiberById(inner.identifier) === null).toBe(hasNested);
    for (const fixture of [outer, inner]) {
      fixture.restoreTree();
      fixture.resetScanReads();
      for (const fiber of fixture.fibers) expect(getLatestFiber(fiber)).toBe(fixture.fibers[0]);
      expect(fixture.getScanReads()).toBe(0);
    }
    return [...trace];
  } finally {
    unsubscribeFirst();
    unsubscribeSecond();
    hook.onCommitFiberUnmount = () => {};
    const unsubscribe = instrument({ target });
    hook.onCommitFiberUnmount(rendererId, outer.fibers[1]);
    hook.onCommitFiberUnmount(rendererId, inner.fibers[1]);
    unsubscribe();
    expect(getFiberById(outer.identifier)).toBeNull();
    expect(getFiberById(inner.identifier)).toBeNull();
  }
};

it.each(
  [false, true].flatMap((crossesReturns) =>
    [false, true].flatMap((hasNested) =>
      [0, 1].map((assignedIndex) => ({ crossesReturns, hasNested, assignedIndex })),
    ),
  ),
)(
  "resolves current during unmount, crossed $crossesReturns, nested $hasNested, assignment $assignedIndex",
  (options) => {
    expect(runUnmountCurrent(options)).toEqual(runUnmountCurrent(options));
  },
);
