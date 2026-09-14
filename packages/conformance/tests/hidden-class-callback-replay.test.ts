import * as React from "react";
import { jsx } from "react/jsx-runtime";
import {
  _fiberRoots,
  ReactFiberFlags,
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

interface HiddenClassProps {
  owner: number;
  role: string;
}
interface HiddenClassState {
  value: number;
}
interface HiddenClassIdentity {
  fiber: Fiber;
  identifier: number;
  hostIdentifier: number;
  host: HTMLSpanElement;
  instance: React.Component<HiddenClassProps, HiddenClassState>;
}
interface HiddenVisibility {
  outer: boolean;
  inner: boolean;
  present: boolean;
}
interface HiddenBoundaryProps {
  owner: number;
  children: React.ReactNode;
}
interface HiddenBoundaryState {
  failed: boolean;
}
interface HiddenQueue {
  shared: object;
  hidden: unknown;
  regular: unknown;
}
interface HiddenCallbackOptions {
  owner: number;
  outcome: "reveal" | "reject" | "delete";
  schedulesMountUpdate: boolean;
}

const nativeClassCallbackFlag = 64;

const getQueue = (fiber: Fiber): HiddenQueue => {
  const queue: unknown = fiber.updateQueue;
  if (typeof queue !== "object" || queue === null) throw new Error("Missing class queue");
  const shared: unknown = Reflect.get(queue, "shared");
  if (typeof shared !== "object" || shared === null) throw new Error("Missing shared class queue");
  return {
    shared,
    hidden: Reflect.get(shared, "hiddenCallbacks"),
    regular: Reflect.get(queue, "callbacks"),
  };
};

const runHiddenCallbacks = async ({
  owner,
  outcome,
  schedulesMountUpdate,
}: HiddenCallbackOptions): Promise<string[]> => {
  const trace: string[] = [];
  const transcript: string[] = [];
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const failure = new Error("hidden class callback failed");
  const observerFailure = new Error("hidden class deletion observer failed");
  const reporterFailure = new Error("hidden class reporter failed");
  const caught: unknown[] = [];
  const boundary = React.createRef<Boundary>();
  const harnesses = [0, 1].map(() =>
    createRenderHarness({
      onCaughtError: (error, errorInfo) => {
        caught.push(error);
        record(`caught:${error === failure}:${errorInfo.errorBoundary === boundary.current}`);
      },
    }),
  );
  const identities: HiddenClassIdentity[][] = [[], []];
  let updateVisibility = (_visibility: HiddenVisibility): void => {
    throw new Error("Missing visibility control");
  };
  let failsDeletion = false;
  const revealedValue = schedulesMountUpdate ? 5 : 4;
  const getLive = (identity: HiddenClassIdentity): string =>
    `${getFiberById(identity.identifier)?.memoizedState?.value ?? "gone"}:${getFiberById(identity.hostIdentifier) !== null}`;
  class Probe extends React.PureComponent<HiddenClassProps, HiddenClassState> {
    state = { value: 0 };
    identity: HiddenClassIdentity | null = null;
    getIdentity = (): HiddenClassIdentity => {
      if (!this.identity) throw new Error("Missing hidden class identity");
      return this.identity;
    };
    getName = () => `${this.props.owner}:${this.props.role}:${this.state.value}`;
    attach = (host: HTMLSpanElement | null) => {
      if (!host) throw new Error("Unexpected null hidden-class ref");
      const hostFiber = getFiber(host);
      const fiber = hostFiber?.return;
      if (!fiber || !hostFiber || fiber.stateNode !== this)
        throw new Error("Missing hidden class parent");
      if (!this.identity) {
        this.identity = {
          fiber,
          identifier: getFiberId(fiber),
          hostIdentifier: getFiberId(hostFiber),
          host,
          instance: this,
        };
        identities[this.props.owner].push(this.identity);
      }
      const identity = this.identity;
      record(`ref-on:${this.getName()}:${getLive(identity)}:${host === identity.host}`);
      return () => record(`ref-off:${this.getName()}:${getLive(identity)}`);
    };
    componentDidMount = () => {
      record(`mount:${this.getName()}:${getLive(this.getIdentity())}`);
      if (schedulesMountUpdate && this.props.owner === owner && this.state.value === 4) {
        record(`schedule:5:${getLive(this.getIdentity())}`);
        this.setState({ value: 5 }, () => record(`mount-callback:${getLive(this.getIdentity())}`));
      }
    };
    componentDidUpdate = () => record(`layout:${this.getName()}:${getLive(this.getIdentity())}`);
    componentWillUnmount = () => record(`unmount:${this.getName()}:${getLive(this.getIdentity())}`);
    render = () => {
      record(`render:${this.getName()}`);
      return jsx("span", { ref: this.attach, children: this.getName() });
    };
  }
  const App = () => {
    const [visibility, setVisibility] = React.useState<HiddenVisibility>({
      outer: false,
      inner: false,
      present: true,
    });
    updateVisibility = setVisibility;
    const child = React.useMemo(() => jsx(Probe, { owner, role: "primary" }), []);
    return jsx(React.Activity, {
      mode: visibility.outer ? "hidden" : "visible",
      children: jsx(React.Activity, {
        mode: visibility.inner ? "hidden" : "visible",
        children: visibility.present ? child : null,
      }),
    });
  };
  class Boundary extends React.Component<HiddenBoundaryProps, HiddenBoundaryState> {
    state = { failed: false };
    static getDerivedStateFromError = (): HiddenBoundaryState => ({ failed: true });
    render = () =>
      this.state.failed
        ? jsx(Probe, { owner: this.props.owner, role: "fallback" })
        : this.props.children;
  }
  const render = (epoch: number) =>
    harnesses[owner].render(
      jsx(Boundary, { owner, ref: boundary, children: jsx(App, {}) }, String(epoch)),
    );
  const getIdentity = (checkedOwner = owner): HiddenClassIdentity => {
    const identity = identities[checkedOwner].at(-1);
    if (!identity) throw new Error("Missing committed hidden class");
    return identity;
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === observerFailure}`);
      throw reporterFailure;
    });
  using _fault = instrument({
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe || fiber.memoizedProps.owner !== owner || !failsDeletion) return;
      failsDeletion = false;
      record(`delete-fault:${getLive(getIdentity())}`);
      throw observerFailure;
    },
  });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      const checkedOwner = harnesses.findIndex(
        (harness) => "containerInfo" in root && root.containerInfo === harness.container,
      );
      if (checkedOwner === -1) return;
      const fiber = getFiberPreorder(root.current).find((candidate) => candidate.type === Probe);
      if (fiber) {
        const identity = getIdentity(checkedOwner);
        record(
          `commit:${checkedOwner}:${fiber.memoizedProps.role}:${fiber.memoizedState?.value}:${identity.host.style.display || "visible"}:${getFiberById(identity.identifier) === fiber}:${_fiberRoots.has(root)}`,
        );
      } else record(`commit:${checkedOwner}:empty:${_fiberRoots.has(root)}`);
      traverseRenderedFibers(checkedOwner === 0 ? root.current : root, (fiber, phase) => {
        if (fiber.type === Probe)
          record(
            `phase:${checkedOwner}:${fiber.memoizedProps.role}:${fiber.memoizedState?.value}:${phase}`,
          );
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe) return;
      if (!(fiber.stateNode instanceof Probe)) throw new Error("Missing deleted hidden class");
      record(`delete:${fiber.stateNode.getName()}:${getLive(fiber.stateNode.getIdentity())}`);
    },
  });
  const getCommit = (
    value: number,
    isHidden: boolean,
    phase?: string,
    role = "primary",
    checkedOwner = owner,
  ): string[] => [
    `commit:${checkedOwner}:${role}:${value}:${isHidden ? "none" : "visible"}:true:true`,
    ...(phase ? [`phase:${checkedOwner}:${role}:${value}:${phase}`] : []),
  ];
  const getMount = (value: number, role = "primary", checkedOwner = owner): string[] => [
    `ref-on:${checkedOwner}:${role}:${value}:${value}:true:true`,
    `mount:${checkedOwner}:${role}:${value}:${value}:true`,
    ...(value === 4 && schedulesMountUpdate ? ["schedule:5:4:true"] : []),
  ];
  const getDisconnect = (value: number): string[] => [
    `unmount:${owner}:primary:${value}:${value}:true`,
    `ref-off:${owner}:primary:${value}:${value}:true`,
  ];
  const getDelete = (
    value: number,
    isHidden: boolean,
    role = "primary",
    checkedOwner = owner,
  ): string[] => [
    `delete:${checkedOwner}:${role}:${value}:${value}:true`,
    ...(isHidden
      ? []
      : [
          `unmount:${checkedOwner}:${role}:${value}:gone:true`,
          `ref-off:${checkedOwner}:${role}:${value}:gone:false`,
        ]),
  ];
  const checkVisibility = (outer: boolean, inner: boolean): void => {
    const activities = getFiberPreorder(harnesses[owner].getRoot().current).filter(
      (fiber) => fiber.elementType === React.Activity,
    );
    expect(activities).toHaveLength(2);
    expect(activities.map((fiber) => fiber.memoizedProps.mode)).toEqual(
      [outer, inner].map((isHidden) => (isHidden ? "hidden" : "visible")),
    );
    expect(activities.every((fiber) => fiber.child !== null)).toBe(true);
    expect(activities.map((fiber) => fiber.child?.memoizedState !== null)).toEqual([outer, inner]);
  };
  const retire = (identity: HiddenClassIdentity): void => {
    expect(getFiberById(identity.identifier)).toBeNull();
    expect(getFiberById(identity.hostIdentifier)).toBeNull();
    expect(identity.host.isConnected).toBe(false);
  };
  const check = (identity: HiddenClassIdentity, value: number, isHidden: boolean): Fiber => {
    const checkedOwner = identity.instance.props.owner;
    const root = harnesses[checkedOwner].getRoot();
    const fiber = getFiberPreorder(root.current).find((candidate) => candidate.type === Probe);
    if (!fiber) throw new Error("Missing live class");
    expect(fiber.stateNode).toBe(identity.instance);
    expect(fiber.memoizedState?.value).toBe(value);
    expect(identity.instance.state.value).toBe(value);
    expect(getFiberById(identity.identifier)).toBe(fiber);
    expect(getLatestFiber(identity.fiber)).toBe(fiber);
    if (fiber.alternate) expect(getLatestFiber(fiber.alternate)).toBe(fiber);
    expect(getFiberById(identity.hostIdentifier)?.stateNode).toBe(identity.host);
    expect(identity.host.textContent).toBe(
      `${checkedOwner}:${identity.instance.props.role}:${value}`,
    );
    expect(identity.host.style.display).toBe(isHidden ? "none" : "");
    expect(identity.host.isConnected).toBe(true);
    expect(_fiberRoots.has(root)).toBe(true);
    return fiber;
  };
  await render(0);
  expect(trace.splice(0)).toEqual([
    `render:${owner}:primary:0`,
    ...getMount(0),
    ...getCommit(0, false, "mount"),
  ]);
  const primary = getIdentity();
  checkVisibility(false, false);
  const originalBoundary = boundary.current;
  await harnesses[1 - owner].render(jsx(Probe, { owner: 1 - owner, role: "control" }));
  expect(trace.splice(0)).toEqual([
    `render:${1 - owner}:control:0`,
    ...getMount(0, "control", 1 - owner),
    ...getCommit(0, false, "mount", "control", 1 - owner),
  ]);
  const control = getIdentity(1 - owner);
  const callbacks = [1, 2, 3, 4].map((value) => () => {
    const fiber = getFiberById(primary.identifier);
    if (!fiber) throw new Error("Missing callback fiber");
    const queue = getQueue(fiber);
    record(
      `callback:${value}:${getLive(primary)}:${primary.instance.state.value}:${queue.hidden === null}:${value === 4 ? queue.regular === null : Array.isArray(queue.regular) && queue.regular.length === 1 && queue.regular[0] === callbacks[3]}:${fiber.lanes !== 0}`,
    );
    if (outcome === "reject" && value === 2) throw failure;
  });
  const audit = (value: number): unknown => {
    const fiber = check(primary, value, true);
    const queue = getQueue(fiber);
    expect(queue.hidden).toEqual(callbacks.slice(0, value));
    if (!fiber.alternate) throw new Error("Missing hidden class alternate");
    expect(getQueue(fiber.alternate).shared).toBe(queue.shared);
    check(control, 0, false);
    return queue.hidden;
  };
  await React.act(async () => updateVisibility({ outer: false, inner: true, present: true }));
  expect(trace.splice(0)).toEqual([
    ...getDisconnect(0),
    ...getCommit(0, true),
    ...getCommit(0, true),
  ]);
  check(primary, 0, true);
  checkVisibility(false, true);
  await React.act(async () => primary.instance.setState({ value: 1 }, callbacks[0]));
  expect(trace.splice(0)).toEqual([
    ...getCommit(0, true),
    `render:${owner}:primary:1`,
    ...getCommit(1, true, "update"),
  ]);
  const firstBatch = audit(1);
  const bailedCallback = () => record("bailed-callback");
  await React.act(async () => primary.instance.setState({ value: 1 }, bailedCallback));
  expect(trace.splice(0)).toEqual([...getCommit(1, true), ...getCommit(1, true)]);
  const bailedFiber = check(primary, 1, true);
  const bailedQueue = getQueue(bailedFiber);
  expect(bailedQueue.hidden).toEqual([callbacks[0]]);
  expect(bailedQueue.regular).toEqual([bailedCallback]);
  expect(bailedFiber.flags & nativeClassCallbackFlag).toBe(nativeClassCallbackFlag);
  expect(
    bailedFiber.flags &
      (ReactFiberFlags.PerformedWork | ReactFiberFlags.Update | ReactFiberFlags.Visibility),
  ).toBe(0);
  await React.act(async () => primary.instance.setState({ value: 2 }, callbacks[1]));
  expect(trace.splice(0)).toEqual([
    ...getCommit(1, true),
    `render:${owner}:primary:2`,
    ...getCommit(2, true, "update"),
  ]);
  audit(2);
  expect(bailedQueue.regular).toEqual([bailedCallback]);
  expect(firstBatch).toEqual([callbacks[0]]);
  await React.act(async () => updateVisibility({ outer: true, inner: true, present: true }));
  expect(trace.splice(0)).toEqual([...getCommit(2, true), ...getCommit(2, true)]);
  checkVisibility(true, true);
  await React.act(async () => updateVisibility({ outer: true, inner: false, present: true }));
  expect(trace.splice(0)).toEqual([...getCommit(2, true), ...getCommit(2, true)]);
  checkVisibility(true, false);
  audit(2);
  await React.act(async () => primary.instance.setState({ value: 3 }, callbacks[2]));
  expect(trace.splice(0)).toEqual([
    ...getCommit(2, true),
    `render:${owner}:primary:3`,
    ...getCommit(3, true, "update"),
  ]);
  const deferredBatch = audit(3);
  if (outcome === "delete") {
    failsDeletion = true;
    await React.act(async () => updateVisibility({ outer: true, inner: false, present: false }));
    expect(trace.splice(0)).toEqual([
      ...getCommit(3, true),
      "delete-fault:3:true",
      "report:Bippy instrumentation encountered an error::true",
      ...getDelete(3, true),
      `commit:${owner}:empty:true`,
    ]);
    retire(primary);
    checkVisibility(true, false);
  } else {
    failsDeletion = outcome === "reject";
    await React.act(async () => {
      updateVisibility({ outer: false, inner: false, present: true });
      primary.instance.setState({ value: 4 }, callbacks[3]);
    });
    expect(trace.splice(0)).toEqual([
      `render:${owner}:primary:4`,
      ...getMount(4),
      `callback:1:4:true:4:true:true:${schedulesMountUpdate}`,
      `callback:2:4:true:4:true:true:${schedulesMountUpdate}`,
      ...(outcome === "reject" ? [] : [`callback:3:4:true:4:true:true:${schedulesMountUpdate}`]),
      `callback:4:4:true:4:true:true:${schedulesMountUpdate}`,
      ...getCommit(4, false, "update"),
      ...(outcome === "reject"
        ? [
            `render:${owner}:fallback:0`,
            "delete-fault:4:true",
            "report:Bippy instrumentation encountered an error::true",
            ...getDelete(4, false),
            ...getMount(0, "fallback"),
            "caught:true:true",
            ...getCommit(0, false, "mount", "fallback"),
          ]
        : schedulesMountUpdate
          ? [
              `render:${owner}:primary:5`,
              `layout:${owner}:primary:5:5:true`,
              "mount-callback:5:true",
              ...getCommit(5, false, "update"),
            ]
          : []),
    ]);
    if (outcome === "reject") {
      expect(primary.instance.state.value).toBe(4);
      retire(primary);
      expect(boundary.current).toBe(originalBoundary);
      expect(getIdentity().identifier).not.toBe(primary.identifier);
      check(getIdentity(), 0, false);
    } else {
      expect(getQueue(check(primary, revealedValue, false)).hidden).toBeNull();
      expect(identities[owner]).toHaveLength(1);
      await React.act(async () => updateVisibility({ outer: true, inner: false, present: true }));
      expect(trace.splice(0)).toEqual([
        ...getDisconnect(revealedValue),
        ...getCommit(revealedValue, true),
        ...getCommit(revealedValue, true),
      ]);
      await React.act(async () => updateVisibility({ outer: false, inner: false, present: true }));
      expect(trace.splice(0)).toEqual([
        ...getMount(revealedValue),
        ...getCommit(revealedValue, false),
      ]);
      check(primary, revealedValue, false);
      checkVisibility(false, false);
    }
  }
  expect(deferredBatch).toEqual(callbacks.slice(0, 3));
  expect(failsDeletion).toBe(false);
  check(control, 0, false);
  const previous = getIdentity();
  await render(1);
  expect(trace.splice(0)).toEqual([
    `render:${owner}:primary:0`,
    ...(outcome === "delete"
      ? []
      : getDelete(
          outcome === "reject" ? 0 : revealedValue,
          false,
          outcome === "reject" ? "fallback" : "primary",
        )),
    ...getMount(0),
    ...getCommit(0, false, "mount"),
  ]);
  retire(previous);
  const replacement = getIdentity();
  expect(replacement.identifier).not.toBe(previous.identifier);
  expect(replacement.instance).not.toBe(primary.instance);
  expect(boundary.current).not.toBe(originalBoundary);
  await React.act(async () =>
    primary.instance.setState({ value: 99 }, () => record("retired-callback")),
  );
  expect(trace.splice(0)).toEqual([]);
  check(replacement, 0, false);
  check(control, 0, false);
  await harnesses[owner].render(null);
  expect(trace.splice(0)).toEqual([...getDelete(0, false), `commit:${owner}:empty:false`]);
  retire(replacement);
  await harnesses[1 - owner].render(null);
  expect(trace.splice(0)).toEqual([
    ...getDelete(0, false, "control", 1 - owner),
    `commit:${1 - owner}:empty:false`,
  ]);
  retire(control);
  expect(caught).toEqual(outcome === "reject" ? [failure] : []);
  return transcript;
};

const outcomes: HiddenCallbackOptions["outcome"][] = ["reveal", "reject", "delete"];
it.each(
  outcomes.flatMap((outcome) =>
    [0, 1].flatMap((owner) =>
      (outcome === "delete" ? [false] : [false, true]).map((schedulesMountUpdate) => ({
        owner,
        outcome,
        schedulesMountUpdate,
      })),
    ),
  ),
)(
  "replays nested hidden class callbacks, owner $owner, $outcome, mount update $schedulesMountUpdate",
  async (options) => {
    expect(await runHiddenCallbacks(options)).toEqual(await runHiddenCallbacks(options));
  },
);
