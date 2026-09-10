import * as React from "react";
import { jsx } from "react/jsx-runtime";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  _fiberRoots,
  getFiber,
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  getReactWorkTags,
  instrument,
  traverseRenderedFibers,
  type Fiber,
  type FiberRoot,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface NestedCommitState {
  name: string | null;
  value: number;
}

interface NestedCommitProps {
  name: string;
  value: number;
}

interface NestedCommitIdentity {
  identifier: number;
  fiber: Fiber;
  host: HTMLSpanElement;
}

const getNextState = (
  operation: string,
  value: number,
  previous: NestedCommitState,
): NestedCommitState => ({
  name:
    operation === "empty" ? null : operation === "replace" ? `replacement-${value}` : previous.name,
  value,
});
const getLabel = (state: NestedCommitState): string =>
  state.name === null ? "empty" : `${state.name}:${state.value}`;
const getExpectedPhase = (previous: NestedCommitState, next: NestedCommitState): string[] =>
  next.name === null
    ? previous.name === null
      ? []
      : ["phase:root:unmount"]
    : [`phase:${getLabel(next)}:${previous.name === next.name ? "update" : "mount"}`];
const getExpectedEffects = (previous: NestedCommitState, next: NestedCommitState): string[] => [
  ...(previous.name === null
    ? []
    : [
        ...(previous.name !== next.name
          ? [`delete:${getLabel(previous)}:true`, "report:delete"]
          : []),
        `layout-off:${getLabel(previous)}:${previous.name !== next.name}`,
      ]),
  ...(next.name === null ? [] : [`layout-on:${getLabel(next)}:true`]),
];

const runNestedCommit = async (
  operations: string[],
  usesFiberArgument: boolean,
): Promise<string[]> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const publicRoot = createRoot(container);
  const control = createRenderHarness();
  const identities = new Map<string, NestedCommitIdentity>();
  const transcript: string[] = [];
  const trace: string[] = [];
  const reports: unknown[] = [];
  const commitFailure = new Error("outer commit observer failed");
  const deletionFailure = new Error("nested deletion observer failed");
  let committedRoot: FiberRoot | undefined;
  let isArmed = false;
  let outerFiber: Fiber | undefined;
  const initial = { name: "original", value: 0 };
  const outer = { name: "original", value: 1 };
  const schedule = operations.reduce<NestedCommitState[]>(
    (states, operation, index) => [
      ...states,
      getNextState(operation, index + 2, states.at(-1) ?? outer),
    ],
    [],
  );
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const Probe = ({ name, value }: NestedCommitProps) => {
    const rendering = getRenderingFiber();
    React.useLayoutEffect(() => {
      if (!rendering || !(rendering.child?.stateNode instanceof HTMLSpanElement))
        throw new Error("Missing rendering host");
      const identifier = getFiberId(rendering);
      if (!identities.has(name))
        identities.set(name, { identifier, fiber: rendering, host: rendering.child.stateNode });
      record(`layout-on:${name}:${value}:${getLatestFiber(rendering) === rendering}`);
      return () => {
        record(`layout-off:${name}:${value}:${getFiberById(identifier) === null}`);
      };
    }, [name, value]);
    return jsx("span", { children: `${name}:${value}` });
  };
  const getTree = (state: NestedCommitState) =>
    state.name === null ? null : jsx(Probe, { name: state.name, value: state.value }, state.name);
  const getRoot = (): FiberRoot => {
    if (!committedRoot) throw new Error("Missing committed root");
    return committedRoot;
  };
  const getProbe = (root: FiberRoot): Fiber | undefined =>
    getFiberPreorder(root.current).find((fiber) => fiber.type === Probe);
  const getCommittedLabel = (root: FiberRoot): string => {
    const probe = getProbe(root);
    return probe ? `${probe.memoizedProps.name}:${probe.memoizedProps.value}` : "empty";
  };
  const visit = (root: FiberRoot): void => {
    traverseRenderedFibers(usesFiberArgument ? root.current : root, (fiber, phase) => {
      if (fiber.type === Probe)
        record(`phase:${fiber.memoizedProps.name}:${fiber.memoizedProps.value}:${phase}`);
      else if (fiber.tag === getReactWorkTags().HostRoot && phase === "unmount")
        record("phase:root:unmount");
    });
  };
  const checkIdentity = (state: NestedCommitState): void => {
    const root = getRoot();
    const current = getProbe(root);
    expect(getCommittedLabel(root)).toBe(getLabel(state));
    expect(_fiberRoots.has(root)).toBe(state.name !== null);
    expect(container.textContent).toBe(state.name === null ? "" : getLabel(state));
    for (const [name, identity] of identities) {
      if (name === "control") continue;
      if (name !== state.name) {
        expect(getFiberById(identity.identifier)).toBeNull();
        expect(getFiber(identity.host)).toBeNull();
        expect(identity.host.isConnected).toBe(false);
      } else {
        if (!current) throw new Error("Missing current probe");
        expect(getFiberId(current)).toBe(identity.identifier);
        expect(getFiberById(identity.identifier) === current).toBe(true);
        expect(getLatestFiber(identity.fiber) === current).toBe(true);
        expect(current.child?.stateNode === identity.host).toBe(true);
        const capturedHost = getFiber(identity.host);
        expect(capturedHost && getLatestFiber(capturedHost) === current.child).toBe(true);
      }
    }
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((_message: unknown, error: unknown) => {
      reports.push(error);
      record(
        `report:${error === commitFailure ? "commit" : error === deletionFailure ? "delete" : "unknown"}`,
      );
      throw new Error("nested commit reporter failed");
    });
  using _first = instrument({
    onCommitFiberRoot: (rendererId, root, priority, didError) => {
      if (!("containerInfo" in root) || root.containerInfo !== container) return;
      expect(getRDTHook().renderers.get(rendererId) === renderer).toBe(true);
      expect(didError).toBe(false);
      committedRoot = root;
      const entryLabel = getCommittedLabel(root);
      record(`first:${entryLabel}:${_fiberRoots.has(root)}:${priority}`);
      visit(root);
      if (isArmed) {
        isArmed = false;
        outerFiber = root.current;
        for (const state of schedule) {
          record(`flush-enter:${getLabel(state)}`);
          flushSync(() => publicRoot.render(getTree(state)));
          record(`flush-exit:${getCommittedLabel(root)}`);
          checkIdentity(state);
        }
        record(`first-exit:${entryLabel}->${getCommittedLabel(root)}`);
        throw commitFailure;
      }
      record(`first-exit:${entryLabel}->${getCommittedLabel(root)}`);
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe) return;
      const identity = identities.get(String(fiber.memoizedProps.name));
      record(
        `delete:${fiber.memoizedProps.name}:${fiber.memoizedProps.value}:${identity !== undefined && getFiberById(identity.identifier) === fiber}`,
      );
      throw deletionFailure;
    },
  });
  using _later = instrument({
    onCommitFiberRoot: (rendererId, root, priority, didError) => {
      if (!("containerInfo" in root) || root.containerInfo !== container) return;
      expect(getRDTHook().renderers.get(rendererId) === renderer).toBe(true);
      expect(didError).toBe(false);
      record(`later:${getCommittedLabel(root)}:${_fiberRoots.has(root)}:${priority}`);
      visit(root);
    },
  });
  const getExpectedObservers = (
    previous: NestedCommitState,
    next: NestedCommitState,
    priority = 3,
  ): string[] => [
    `first:${getLabel(next)}:${next.name !== null}:${priority}`,
    ...getExpectedPhase(previous, next),
    `first-exit:${getLabel(next)}->${getLabel(next)}`,
    `later:${getLabel(next)}:${next.name !== null}:${priority}`,
    ...getExpectedPhase(previous, next),
  ];
  try {
    await control.render(jsx(Probe, { name: "control", value: 0 }));
    expect(trace.splice(0)).toEqual(["layout-on:control:0:true"]);
    const controlIdentity = identities.get("control");
    if (!controlIdentity) throw new Error("Missing control identity");
    const empty: NestedCommitState = { name: null, value: -1 };
    await React.act(async () => publicRoot.render(getTree(initial)));
    expect(trace.splice(0)).toEqual([
      ...getExpectedEffects(empty, initial),
      ...getExpectedObservers(empty, initial),
    ]);
    checkIdentity(initial);
    isArmed = true;
    await React.act(async () => publicRoot.render(getTree(outer)));
    const expected = [
      ...getExpectedEffects(initial, outer),
      `first:${getLabel(outer)}:true:3`,
      ...getExpectedPhase(initial, outer),
    ];
    let previous: NestedCommitState = outer;
    for (const state of schedule) {
      expected.push(
        `flush-enter:${getLabel(state)}`,
        ...getExpectedEffects(previous, state),
        ...getExpectedObservers(previous, state, 1),
        `flush-exit:${getLabel(state)}`,
      );
      previous = state;
    }
    const last = schedule.at(-1);
    if (!last) throw new Error("Missing nested schedule");
    const beforeLast = schedule.at(-2) ?? outer;
    expected.push(
      `first-exit:${getLabel(outer)}->${getLabel(last)}`,
      "report:commit",
      `later:${getLabel(last)}:${last.name !== null}:3`,
      ...getExpectedPhase(beforeLast, last),
    );
    expect(trace.splice(0)).toEqual(expected);
    expect(isArmed).toBe(false);
    expect(getRoot().current === outerFiber).toBe(schedule.length % 2 === 0);
    checkIdentity(last);
    expect(getFiberById(controlIdentity.identifier) === controlIdentity.fiber).toBe(true);
    expect(controlIdentity.host.isConnected).toBe(true);
    const recovered: NestedCommitState = { name: "recovered", value: 4 };
    await React.act(async () => publicRoot.render(getTree(recovered)));
    expect(trace.splice(0)).toEqual([
      ...getExpectedEffects(last, recovered),
      ...getExpectedObservers(last, recovered),
    ]);
    checkIdentity(recovered);
    await React.act(async () => publicRoot.unmount());
    expect(trace.splice(0)).toEqual([
      ...getExpectedEffects(recovered, empty),
      ...getExpectedObservers(recovered, empty, 1),
    ]);
    checkIdentity(empty);
    expect(_fiberRoots.has(control.getRoot())).toBe(true);
    expect(getFiberById(controlIdentity.identifier) === controlIdentity.fiber).toBe(true);
    await control.render(null);
    expect(trace.splice(0)).toEqual([
      "delete:control:0:true",
      "report:delete",
      "layout-off:control:0:true",
    ]);
    for (const identity of identities.values())
      expect(getFiberById(identity.identifier)).toBeNull();
    expect(reports.filter((error) => error === commitFailure)).toHaveLength(1);
    expect(reports.every((error) => error === commitFailure || error === deletionFailure)).toBe(
      true,
    );
    return transcript;
  } finally {
    await React.act(async () => publicRoot.unmount());
    container.remove();
  }
};

it.each(
  [
    ["update"],
    ["replace"],
    ["empty"],
    ["replace", "update"],
    ["empty", "replace"],
    ["replace", "empty"],
  ].flatMap((operations) =>
    [false, true].map((usesFiberArgument) => ({ operations, usesFiberArgument })),
  ),
)(
  "replays same-root nested commits $operations, fiber argument $usesFiberArgument",
  async ({ operations, usesFiberArgument }) => {
    expect(await runNestedCommit(operations, usesFiberArgument)).toEqual(
      await runNestedCommit(operations, usesFiberArgument),
    );
  },
);
