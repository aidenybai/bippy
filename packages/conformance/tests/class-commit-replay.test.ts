import * as React from "react";
import { jsx } from "react/jsx-runtime";
import {
  _fiberRoots,
  getFiber,
  getFiberById,
  getFiberId,
  getLatestFiber,
  instrument,
  traverseRenderedFibers,
  type Fiber,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface ClassProbeProps {
  owner: number;
  role: string;
}
interface ClassProbeState {
  count: number;
}
interface ClassSnapshot {
  text: string;
  count: number;
}
interface ClassIdentity {
  fiber: Fiber;
  identifier: number;
  hostIdentifier: number;
  host: HTMLSpanElement;
  instance: React.Component<ClassProbeProps, ClassProbeState>;
}
interface ClassBoundaryProps {
  owner: number;
  children: React.ReactNode;
}
interface ClassBoundaryState {
  failed: boolean;
}
interface ClassCommitOptions {
  failedOwner: number;
  stage: "snapshot" | "layout" | "callback";
  hasCleanupFailure: boolean;
}

const runClassCommit = async ({
  failedOwner,
  stage,
  hasCleanupFailure,
}: ClassCommitOptions): Promise<string[]> => {
  const trace: string[] = [];
  const transcript: string[] = [];
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const failure = new Error(`class ${stage} failed`);
  const cleanupFailure = new Error("class recovery cleanup failed");
  const observerFailure = new Error("class deletion observer failed");
  const reporterFailure = new Error("class reporter failed");
  const caught: unknown[] = [];
  const harness = createRenderHarness({
    onCaughtError: (error, errorInfo) => {
      caught.push(error);
      record(
        `caught:${error === failure}:${error === cleanupFailure}:${errorInfo.errorBoundary === boundaries[failedOwner].current}`,
      );
    },
  });
  const control = createRenderHarness();
  const identities: ClassIdentity[][] = [[], [], []];
  let isArmed = false;
  let failsDeletion = false;
  let commitCount = 0;
  const getName = (owner: number, role: string, count: number): string =>
    `${owner}:${role}:${count}`;
  const getLive = (identity: ClassIdentity): string =>
    `${getFiberById(identity.identifier)?.memoizedState?.count ?? "gone"}:${getFiberById(identity.hostIdentifier) !== null}`;
  const throwIfArmed = (
    instance: React.Component<ClassProbeProps, ClassProbeState>,
    point: ClassCommitOptions["stage"],
  ): void => {
    if (
      isArmed &&
      instance.props.owner === failedOwner &&
      instance.props.role === "primary" &&
      point === stage
    ) {
      isArmed = false;
      record(`fault:${point}`);
      throw failure;
    }
  };
  class Probe extends React.Component<ClassProbeProps, ClassProbeState> {
    state = { count: 0 };
    identity: ClassIdentity | null = null;
    snapshot: ClassSnapshot | null = null;
    getIdentity = (): ClassIdentity => {
      if (!this.identity) throw new Error("Missing class identity");
      return this.identity;
    };
    getName = (): string => getName(this.props.owner, this.props.role, this.state.count);
    attach = (host: HTMLSpanElement | null) => {
      if (!host) throw new Error("Unexpected class null ref");
      const hostFiber = getFiber(host);
      const fiber = hostFiber?.return;
      if (!hostFiber || !fiber || fiber.stateNode !== this)
        throw new Error("Missing class host parent");
      const identity = {
        fiber,
        identifier: getFiberId(fiber),
        hostIdentifier: getFiberId(hostFiber),
        host,
        instance: this,
      };
      this.identity = identity;
      identities[this.props.owner].push(identity);
      record(`ref-on:${this.getName()}:${getLive(identity)}`);
      return () => record(`ref-off:${this.getName()}:${getLive(identity)}:${host.isConnected}`);
    };
    shouldComponentUpdate = (_props: ClassProbeProps, state: ClassProbeState): boolean => {
      record(`check:${this.props.owner}:${this.state.count}:${state.count}`);
      return state.count !== 1;
    };
    getSnapshotBeforeUpdate = (_props: ClassProbeProps, state: ClassProbeState): ClassSnapshot => {
      const identity = this.getIdentity();
      const text = identity.host.textContent ?? "";
      record(`snapshot:${this.getName()}:${state.count}:${text}:${getLive(identity)}`);
      throwIfArmed(this, "snapshot");
      const snapshot = { text, count: state.count };
      this.snapshot = snapshot;
      return snapshot;
    };
    componentDidMount = () => record(`mount:${this.getName()}:${getLive(this.getIdentity())}`);
    componentDidUpdate = (
      _props: ClassProbeProps,
      state: ClassProbeState,
      snapshot?: ClassSnapshot,
    ) => {
      record(
        `layout:${this.getName()}:${state.count}:${snapshot?.text}:${snapshot?.count}:${snapshot === this.snapshot}:${getLive(this.getIdentity())}`,
      );
      throwIfArmed(this, "layout");
    };
    componentWillUnmount = () => {
      record(`unmount:${this.getName()}:${getLive(this.getIdentity())}`);
      if (
        hasCleanupFailure &&
        this.props.owner === failedOwner &&
        this.props.role === "primary" &&
        this.state.count === 2
      ) {
        record("fault:cleanup");
        throw cleanupFailure;
      }
    };
    render = () => {
      record(`render:${this.getName()}`);
      return jsx("span", { ref: this.attach, children: this.getName() });
    };
  }
  class Boundary extends React.Component<ClassBoundaryProps, ClassBoundaryState> {
    state = { failed: false };
    static getDerivedStateFromError = (): ClassBoundaryState => ({ failed: true });
    render = () =>
      this.state.failed
        ? jsx(Probe, { owner: this.props.owner, role: "fallback" })
        : this.props.children;
  }
  const boundaries = [React.createRef<Boundary>(), React.createRef<Boundary>()];
  const elements = [0, 1].map((owner) =>
    jsx(
      Boundary,
      { owner, ref: boundaries[owner], children: jsx(Probe, { owner, role: "primary" }) },
      String(owner),
    ),
  );
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === observerFailure}`);
      throw reporterFailure;
    });
  using _fault = instrument({
    onCommitFiberUnmount: (_renderer, fiber) => {
      if (fiber.type !== Probe || fiber.memoizedProps.owner !== failedOwner || !failsDeletion)
        return;
      failsDeletion = false;
      record(`delete-fault:${failedOwner}:${getLive(getIdentity(failedOwner))}`);
      throw observerFailure;
    },
  });
  using _observer = instrument({
    onCommitFiberRoot: (_renderer, root) => {
      if (!("containerInfo" in root)) return;
      if (root.containerInfo === control.container) {
        record(`control-commit:${control.container.textContent}`);
        return;
      }
      if (root.containerInfo !== harness.container) return;
      const fibers = getFiberPreorder(root.current).filter((fiber) => fiber.type === Probe);
      record(
        `commit:${fibers.map((fiber) => `${fiber.memoizedProps.owner}:${fiber.memoizedProps.role}:${fiber.memoizedState?.count}`).join("|")}:${harness.container.textContent}`,
      );
      for (const fiber of fibers) {
        const owner = fiber.memoizedProps.owner;
        if (typeof owner !== "number") throw new Error("Missing class owner");
        const identity = identities[owner].at(-1);
        record(
          `current:${fiber.memoizedProps.owner}:${identity !== undefined && getFiberById(identity.identifier) === fiber}:${identity !== undefined && getLatestFiber(identity.fiber) === fiber}`,
        );
      }
      traverseRenderedFibers(commitCount++ % 2 ? root.current : root, (fiber, phase) => {
        if (fiber.type === Probe)
          record(
            `phase:${fiber.memoizedProps.owner}:${fiber.memoizedProps.role}:${phase}:${fibers.includes(fiber)}`,
          );
      });
    },
    onCommitFiberUnmount: (_renderer, fiber) => {
      if (fiber.type !== Probe) return;
      if (!(fiber.stateNode instanceof Probe)) throw new Error("Missing deleted class instance");
      record(`delete:${fiber.stateNode.getName()}:${getLive(fiber.stateNode.getIdentity())}`);
    },
  });
  const getIdentity = (owner: number): ClassIdentity => {
    const identity = identities[owner].at(-1);
    if (!identity) throw new Error("Missing committed class");
    return identity;
  };
  const check = (
    owner: number,
    identity: ClassIdentity,
    role: string,
    state: number,
    displayed = state,
  ): void => {
    const root = owner === 2 ? control.getRoot() : harness.getRoot();
    const fiber = getFiberPreorder(root.current).find(
      (innerFiber) => innerFiber.type === Probe && innerFiber.memoizedProps.owner === owner,
    );
    expect(_fiberRoots.has(root)).toBe(true);
    expect(fiber).toBeDefined();
    expect(fiber?.stateNode).toBe(identity.instance);
    expect(fiber?.memoizedState?.count).toBe(state);
    expect(getFiberById(identity.identifier)).toBe(fiber);
    expect(getLatestFiber(identity.fiber)).toBe(fiber);
    if (fiber?.alternate) expect(getLatestFiber(fiber.alternate)).toBe(fiber);
    expect(identity.instance.state.count).toBe(state);
    expect(identity.host.textContent).toBe(getName(owner, role, displayed));
    expect(identity.host.isConnected).toBe(true);
    expect(getFiberById(identity.hostIdentifier)?.stateNode).toBe(identity.host);
  };
  const getCommit = (
    roles: string[],
    counts: number[],
    phases: string[],
    displayed = counts,
  ): string[] => [
    `commit:${[0, 1].map((owner) => getName(owner, roles[owner], counts[owner])).join("|")}:${[0, 1].map((owner) => getName(owner, roles[owner], displayed[owner])).join("")}`,
    "current:0:true:true",
    "current:1:true:true",
    ...phases,
  ];
  const getMount = (owner: number, role: string): string[] => [
    `ref-on:${owner}:${role}:0:0:true`,
    `mount:${owner}:${role}:0:0:true`,
  ];
  const getDelete = (
    owner: number,
    role: string,
    count: number,
    failsCleanup = false,
  ): string[] => [
    `delete:${owner}:${role}:${count}:${count}:true`,
    `unmount:${owner}:${role}:${count}:gone:true`,
    ...(failsCleanup ? ["fault:cleanup"] : []),
    `ref-off:${owner}:${role}:${count}:gone:false:true`,
  ];
  const retire = (identity: ClassIdentity): void => {
    expect(getFiberById(identity.identifier)).toBeNull();
    expect(getFiberById(identity.hostIdentifier)).toBeNull();
    expect(identity.host.isConnected).toBe(false);
  };
  await harness.render(jsx(React.Fragment, { children: elements }));
  expect(trace.splice(0)).toEqual([
    "render:0:primary:0",
    "render:1:primary:0",
    ...getMount(0, "primary"),
    ...getMount(1, "primary"),
    ...getCommit(
      ["primary", "primary"],
      [0, 0],
      ["phase:0:primary:mount:true", "phase:1:primary:mount:true"],
    ),
  ]);
  const original = [getIdentity(0), getIdentity(1)];
  const originalBoundary = boundaries[failedOwner].current;
  await control.render(jsx(Probe, { owner: 2, role: "control" }));
  expect(trace.splice(0)).toEqual([
    "render:2:control:0",
    ...getMount(2, "control"),
    "control-commit:2:control:0",
  ]);
  const controlIdentity = getIdentity(2);
  await React.act(async () => {
    original.forEach((identity, owner) =>
      identity.instance.setState({ count: 1 }, () =>
        record(`bail-callback:${owner}:${getLive(identity)}:${identity.host.textContent}`),
      ),
    );
  });
  expect(trace.splice(0)).toEqual([
    "check:0:0:1",
    "check:1:0:1",
    "bail-callback:0:1:true:0:primary:0",
    "bail-callback:1:1:true:1:primary:0",
    ...getCommit(["primary", "primary"], [1, 1], [], [0, 0]),
  ]);
  original.forEach((identity, owner) => check(owner, identity, "primary", 1, 0));
  await React.act(async () => {
    original.forEach((identity, owner) =>
      identity.instance.forceUpdate(() => record(`force-callback:${owner}:${getLive(identity)}`)),
    );
  });
  expect(trace.splice(0)).toEqual([
    "render:0:primary:1",
    "render:1:primary:1",
    ...[0, 1].map((owner) => `snapshot:${owner}:primary:1:1:${owner}:primary:0:1:true`),
    ...[0, 1].flatMap((owner) => [
      `layout:${owner}:primary:1:1:${owner}:primary:0:1:true:1:true`,
      `force-callback:${owner}:1:true`,
    ]),
    ...getCommit(
      ["primary", "primary"],
      [1, 1],
      ["phase:0:primary:update:true", "phase:1:primary:update:true"],
    ),
  ]);
  original.forEach((identity, owner) => check(owner, identity, "primary", 1));
  isArmed = true;
  failsDeletion = true;
  await React.act(async () => {
    original.forEach((identity, owner) => {
      identity.instance.setState({ count: 2 }, () => {
        record(`callback-a:${owner}:${getLive(identity)}`);
        throwIfArmed(identity.instance, "callback");
      });
      identity.instance.setState(
        (state) => state,
        () => record(`callback-b:${owner}:${getLive(identity)}`),
      );
    });
  });
  const roles = [0, 1].map((owner) => (owner === failedOwner ? "fallback" : "primary"));
  const counts = [0, 1].map((owner) => (owner === failedOwner ? 0 : 2));
  expect(trace.splice(0)).toEqual([
    ...[0, 1].flatMap((owner) => [`check:${owner}:1:2`, `render:${owner}:primary:2`]),
    ...[0, 1].flatMap((owner) => [
      `snapshot:${owner}:primary:2:1:${owner}:primary:1:1:true`,
      ...(owner === failedOwner && stage === "snapshot" ? ["fault:snapshot"] : []),
    ]),
    ...[0, 1].flatMap((owner) => [
      `layout:${owner}:primary:2:1:${owner}:primary:${owner === failedOwner && stage === "snapshot" ? 0 : 1}:1:true:2:true`,
      ...(owner === failedOwner && stage === "layout" ? ["fault:layout"] : []),
      `callback-a:${owner}:2:true`,
      ...(owner === failedOwner && stage === "callback"
        ? ["fault:callback"]
        : [`callback-b:${owner}:2:true`]),
    ]),
    ...getCommit(
      ["primary", "primary"],
      [2, 2],
      ["phase:0:primary:update:true", "phase:1:primary:update:true"],
    ),
    `render:${failedOwner}:fallback:0`,
    `delete-fault:${failedOwner}:2:true`,
    "report:Bippy instrumentation encountered an error::true",
    ...getDelete(failedOwner, "primary", 2, hasCleanupFailure),
    ...getMount(failedOwner, "fallback"),
    "caught:true:false:true",
    ...getCommit(roles, counts, [`phase:${failedOwner}:fallback:mount:true`]),
    ...(hasCleanupFailure
      ? [
          `render:${failedOwner}:fallback:0`,
          ...getDelete(failedOwner, "fallback", 0),
          ...getMount(failedOwner, "fallback"),
          "caught:false:true:true",
          ...getCommit(roles, counts, [`phase:${failedOwner}:fallback:mount:true`]),
        ]
      : []),
  ]);
  expect(isArmed).toBe(false);
  expect(failsDeletion).toBe(false);
  const expectedErrors = hasCleanupFailure ? [failure, cleanupFailure] : [failure];
  expect(caught).toEqual(expectedErrors);
  expect(boundaries[failedOwner].current).toBe(originalBoundary);
  retire(original[failedOwner]);
  const fallback = getIdentity(failedOwner);
  expect(identities[failedOwner]).toHaveLength(hasCleanupFailure ? 3 : 2);
  if (hasCleanupFailure) {
    const firstFallback = identities[failedOwner][1];
    retire(firstFallback);
    expect(fallback.identifier).not.toBe(firstFallback.identifier);
    expect(fallback.instance).not.toBe(firstFallback.instance);
  }
  expect(fallback.identifier).not.toBe(original[failedOwner].identifier);
  expect(fallback.instance).not.toBe(original[failedOwner].instance);
  check(failedOwner, fallback, "fallback", 0);
  check(1 - failedOwner, original[1 - failedOwner], "primary", 2);
  check(2, controlIdentity, "control", 0);
  const replacementElements = elements.map((element, owner) =>
    owner === failedOwner
      ? jsx(
          Boundary,
          {
            owner,
            ref: boundaries[owner],
            children: jsx(Probe, { owner, role: "primary" }),
          },
          "replacement",
        )
      : element,
  );
  await harness.render(jsx(React.Fragment, { children: replacementElements }));
  const remountedCounts = [0, 1].map((owner) => (owner === failedOwner ? 0 : 2));
  expect(trace.splice(0)).toEqual([
    `render:${failedOwner}:primary:0`,
    ...getDelete(failedOwner, "fallback", 0),
    ...getMount(failedOwner, "primary"),
    ...getCommit(["primary", "primary"], remountedCounts, [
      `phase:${failedOwner}:primary:mount:true`,
    ]),
  ]);
  retire(fallback);
  const replacement = getIdentity(failedOwner);
  expect(replacement.identifier).not.toBe(fallback.identifier);
  expect(replacement.identifier).not.toBe(original[failedOwner].identifier);
  expect(boundaries[failedOwner].current).not.toBe(originalBoundary);
  check(failedOwner, replacement, "primary", 0);
  check(1 - failedOwner, original[1 - failedOwner], "primary", 2);
  check(2, controlIdentity, "control", 0);
  expect(identities[failedOwner]).toHaveLength(hasCleanupFailure ? 4 : 3);
  const retired = identities[failedOwner].slice(0, -1);
  await React.act(async () => {
    for (const identity of retired) {
      identity.instance.setState({ count: 99 }, () => record("retired-state-callback"));
      identity.instance.forceUpdate(() => record("retired-force-callback"));
    }
  });
  expect(trace.splice(0)).toEqual([]);
  expect(retired.map((identity) => identity.instance.state.count)).toEqual(
    hasCleanupFailure ? [2, 0, 0] : [2, 0],
  );
  retired.forEach(retire);
  check(failedOwner, replacement, "primary", 0);
  await harness.render(null);
  expect(trace.splice(0)).toEqual([
    ...getDelete(0, "primary", remountedCounts[0]),
    ...getDelete(1, "primary", remountedCounts[1]),
    "commit::",
  ]);
  retire(replacement);
  retire(original[1 - failedOwner]);
  await control.render(null);
  expect(trace.splice(0)).toEqual([...getDelete(2, "control", 0), "control-commit:"]);
  retire(controlIdentity);
  expect(caught).toEqual(expectedErrors);
  return transcript;
};

const stages: ClassCommitOptions["stage"][] = ["snapshot", "layout", "callback"];
it.each(
  stages.flatMap((stage) =>
    [0, 1].flatMap((failedOwner) =>
      [false, true].map((hasCleanupFailure) => ({ stage, failedOwner, hasCleanupFailure })),
    ),
  ),
)(
  "replays class $stage failure after bailout, owner $failedOwner, cleanup failure $hasCleanupFailure",
  async (options) => {
    expect(await runClassCommit(options)).toEqual(await runClassCommit(options));
  },
);
