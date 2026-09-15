import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  _fiberRoots,
  getFiber,
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  instrument,
  isFiber,
  traverseRenderedFibers,
  type Fiber,
  type FiberRoot,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface EventCallback {
  (reason: string, increments?: boolean): void;
}
interface EventOwnerProps {
  owner: number;
}
interface EventProps extends EventOwnerProps {
  epoch: number;
  value: number;
}
interface EventSentinelProps extends EventProps {
  revision: number;
}
interface EventState {
  epoch: number;
  value: number;
  revision: number;
}
interface EventAttempt extends EventProps {
  count: number;
  token: object;
  fiber: Fiber;
  cell: object;
  implementation: EventCallback;
  event: EventCallback;
  payload: unknown;
}
interface EventIdentity {
  fiber: Fiber;
  identifier: number;
  hostIdentifier: number;
  host: HTMLSpanElement | null;
  token: object;
  event: EventCallback;
  cell: object;
}
interface EventOptions {
  owner: number;
  probeFirst: boolean;
  completes: boolean;
}

const isEventRoot = (root: unknown): root is FiberRoot =>
  typeof root === "object" && root !== null && "current" in root && isFiber(root.current);

const getEventRoot = (fiber: Fiber): FiberRoot => {
  let rootFiber = fiber;
  while (rootFiber.return) rootFiber = rootFiber.return;
  const root = rootFiber.stateNode;
  if (!isEventRoot(root)) throw new Error("Missing event FiberRoot");
  return root;
};
const getEventCell = (fiber: Fiber): object => {
  const cell = fiber.memoizedState?.next?.next?.memoizedState;
  if (typeof cell !== "object" || cell === null || !("impl" in cell))
    throw new Error("Missing event implementation cell");
  return cell;
};
const getEventPayload = (fiber: Fiber): unknown => {
  const queue = fiber.updateQueue;
  if (typeof queue !== "object" || queue === null) return null;
  const events = Reflect.get(queue, "events");
  return Array.isArray(events) ? events[0] : null;
};

const runEffectEvents = async ({
  owner,
  probeFirst,
  completes,
}: EventOptions): Promise<string[]> => {
  const harnesses = [createRenderHarness(), createRenderHarness()];
  const gate = { ...Promise.withResolvers<void>(), ready: false };
  let didSettle = false;
  void gate.promise.then(() => {
    didSettle = true;
  });
  const trace: string[] = [];
  const transcript: string[] = [];
  const attempts: EventAttempt[] = [];
  const guardErrors = new Set<string>();
  const identities = new Map<string, EventIdentity>();
  const subscriptions = new Map<number, EventCallback>();
  const implementations = new Map<string, EventCallback>();
  const setters = new Map<number, React.Dispatch<React.SetStateAction<EventState>>>();
  const observerFailure = new Error("effect event deletion observer failed");
  const reporterFailure = new Error("effect event reporter failed");
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getIdentity = (checkedOwner: number, epoch = 0): EventIdentity => {
    const identity = identities.get(`${checkedOwner}:${epoch}`);
    if (!identity) throw new Error("Missing effect event identity");
    return identity;
  };
  const notify = (checkedOwner: number, reason: string, increments = false): void => {
    const callback = subscriptions.get(checkedOwner);
    if (!callback) throw new Error("Missing effect event subscription");
    callback(reason, increments);
  };
  const setState = (state: React.SetStateAction<EventState>): void => {
    const setter = setters.get(owner);
    if (!setter) throw new Error("Missing event parent setter");
    setter(state);
  };
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const describe = (fiber: Fiber | null | undefined): string =>
    fiber
      ? `${fiber.memoizedProps.epoch}/${fiber.memoizedProps.value}/${fiber.memoizedState?.next?.memoizedState}`
      : "none";
  const ProbeBody = ({ owner: checkedOwner, epoch, value }: EventProps) => {
    const [token] = React.useState(() => ({}));
    const [count, setCount] = React.useState(0);
    const rendering = getRenderingFiber();
    if (!rendering) throw new Error("Missing event render fiber");
    const root = getEventRoot(rendering);
    const identifier = getFiberId(rendering);
    const implementation: EventCallback = (reason, increments = false) => {
      const lookup = getFiberById(identifier);
      const current = getFiberPreorder(root.current).find((fiber) => fiber.type === ProbeBody);
      record(
        `event:${checkedOwner}:${reason}:${epoch}/${value}/${count}:${describe(lookup)}:${describe(current)}:${lookup !== null && lookup === current}:${rendering === current}`,
      );
      if (increments) setCount((previous) => previous + 1);
    };
    const event = React.useEffectEvent(implementation);
    const cell = getEventCell(rendering);
    const name = `${checkedOwner}:${epoch}`;
    if (!identities.has(name))
      identities.set(name, {
        fiber: rendering,
        identifier,
        hostIdentifier: -1,
        host: null,
        token,
        event,
        cell,
      });
    attempts.push({
      owner: checkedOwner,
      epoch,
      value,
      count,
      token,
      fiber: rendering,
      cell,
      implementation,
      event,
      payload: getEventPayload(rendering),
    });
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        const identity = getIdentity(checkedOwner, epoch);
        if (!host) {
          record(`ref-off:${name}:${getFiberById(identity.hostIdentifier) !== null}`);
          return;
        }
        const fiber = getFiber(host);
        if (!fiber) throw new Error("Missing event host fiber");
        identity.host = host;
        identity.hostIdentifier = getFiberId(fiber);
        record(`ref-on:${name}`);
      },
      [checkedOwner, epoch],
    );
    React.useInsertionEffect(() => {
      event(`insertion-on:${value}:${count}`);
      return () => {
        event(`insertion-off:${value}:${count}`);
      };
    }, [value, count]);
    React.useLayoutEffect(() => {
      implementations.set(name, implementation);
      event(`layout-on:${value}:${count}`);
      return () => {
        event(`layout-off:${value}:${count}`);
      };
    }, [value, count]);
    React.useEffect(() => {
      record(`subscribe:${name}`);
      subscriptions.set(checkedOwner, event);
      return () => {
        record(`unsubscribe:${name}`);
        if (subscriptions.get(checkedOwner) === event) subscriptions.delete(checkedOwner);
      };
    }, []);
    React.useEffect(() => {
      event(`passive-on:${value}:${count}`);
      return () => {
        event(`passive-off:${value}:${count}`);
      };
    }, [value, count]);
    if (checkedOwner === owner && value === 1 && !gate.ready) {
      try {
        event("render-guard");
      } catch (error) {
        if (error instanceof Error) guardErrors.add(error.message);
      }
      throw gate.promise;
    }
    return jsx("span", {
      "data-owner": checkedOwner,
      "data-epoch": epoch,
      children: `${checkedOwner}:${epoch}:${value}:${count}`,
      ref,
    });
  };
  const Probe = React.memo(ProbeBody);
  const Sentinel = ({ owner: checkedOwner, value, epoch, revision }: EventSentinelProps) => {
    React.useLayoutEffect(
      () => () => {
        notify(checkedOwner, `sentinel:${epoch}:${value}:${revision}`);
      },
      [value, epoch, revision],
    );
    return null;
  };
  const App = ({ owner: checkedOwner }: EventOwnerProps) => {
    const [state, update] = React.useState<EventState>({ epoch: 0, value: 0, revision: 0 });
    setters.set(checkedOwner, update);
    const probe = jsx(
      Probe,
      { owner: checkedOwner, epoch: state.epoch, value: state.value },
      String(state.epoch),
    );
    const sentinel = jsx(
      Sentinel,
      { owner: checkedOwner, epoch: state.epoch, value: state.value, revision: state.revision },
      "sentinel",
    );
    return jsx(React.Suspense, {
      fallback: jsx("b", { children: "fallback" }),
      children: jsxs(React.Fragment, {
        children: probeFirst ? [probe, sentinel] : [sentinel, probe],
      }),
    });
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === observerFailure}`);
      throw reporterFailure;
    });
  using unsubscribe = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      const checkedOwner = harnesses.findIndex(
        (harness) => "containerInfo" in root && root.containerInfo === harness.container,
      );
      if (checkedOwner < 0) return;
      record(`commit:${checkedOwner}:${_fiberRoots.has(root)}`);
      traverseRenderedFibers(checkedOwner === 0 ? root.current : root, (fiber, phase) => {
        if (fiber.type !== ProbeBody && fiber.type !== "span") return;
        record(`phase:${checkedOwner}:${fiber.type === "span" ? "host" : "probe"}:${phase}`);
      });
      if (subscriptions.has(checkedOwner)) notify(checkedOwner, "observer");
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== ProbeBody && fiber.type !== "span") return;
      const isHost = fiber.type === "span";
      const checkedOwner = isHost ? fiber.memoizedProps["data-owner"] : fiber.memoizedProps.owner;
      const epoch = isHost ? fiber.memoizedProps["data-epoch"] : fiber.memoizedProps.epoch;
      const identity = identities.get(`${checkedOwner}:${epoch}`);
      if (!identity) return;
      record(
        `delete:${checkedOwner}:${epoch}:${isHost ? "host" : "probe"}:${getFiberById(isHost ? identity.hostIdentifier : identity.identifier) === fiber}`,
      );
      throw observerFailure;
    },
  });
  const checkTrace = (expected: string[]): void => {
    expect(trace.splice(0)).toEqual(expected);
  };
  const eventTrace = (
    checkedOwner: number,
    reason: string,
    closure: string,
    lookup: string,
    current: string,
    closureCurrent: boolean,
  ): string =>
    `event:${checkedOwner}:${reason}:${closure}:${lookup}:${current}:${lookup !== "none" && lookup === current}:${closureCurrent}`;
  const event = (
    reason: string,
    closure: string,
    lookup: string,
    current: string,
    closureCurrent: boolean,
  ): string => eventTrace(owner, reason, closure, lookup, current, closureCurrent);
  const commit = (checkedOwner: number, phases: string[] = [], mounted = true): string[] => [
    `commit:${checkedOwner}:${mounted}`,
    ...phases.map((phase) => `phase:${checkedOwner}:${phase}`),
  ];
  const mount = (checkedOwner: number): string[] => [
    eventTrace(checkedOwner, "insertion-on:0:0", "0/0/0", "0/0/0", "none", false),
    `ref-on:${checkedOwner}:0`,
    eventTrace(checkedOwner, "layout-on:0:0", "0/0/0", "0/0/0", "0/0/0", true),
    ...commit(checkedOwner, ["probe:mount", "host:mount"]),
    `subscribe:${checkedOwner}:0`,
    eventTrace(checkedOwner, "passive-on:0:0", "0/0/0", "0/0/0", "0/0/0", true),
  ];
  const update = (
    previousValue: number,
    previousCount: number,
    value: number,
    count: number,
    sentinelReason?: string,
  ): string[] => {
    const previous = `0/${previousValue}/${previousCount}`;
    const next = `0/${value}/${count}`;
    return [
      ...(!probeFirst && sentinelReason
        ? [event(sentinelReason, previous, previous, previous, true)]
        : []),
      event(`insertion-off:${previousValue}:${previousCount}`, next, previous, previous, false),
      event(`insertion-on:${value}:${count}`, next, previous, previous, false),
      event(`layout-off:${previousValue}:${previousCount}`, next, previous, previous, false),
      ...(probeFirst && sentinelReason
        ? [event(sentinelReason, next, previous, previous, false)]
        : []),
      event(`layout-on:${value}:${count}`, next, next, next, true),
      ...commit(owner, ["probe:update", "host:update"]),
      event("observer", next, next, next, true),
      event(`passive-off:${previousValue}:${previousCount}`, next, next, next, true),
      event(`passive-on:${value}:${count}`, next, next, next, true),
    ];
  };
  const unmount = (
    checkedOwner: number,
    epoch: number,
    value: number,
    count: number,
    revision: number,
  ): string[] => {
    const snapshot = `${epoch}/${value}/${count}`;
    const name = `${checkedOwner}:${epoch}`;
    const sentinelReason = `sentinel:${epoch}:${value}:${revision}`;
    return [
      ...(!probeFirst
        ? [eventTrace(checkedOwner, sentinelReason, snapshot, snapshot, snapshot, true)]
        : []),
      `delete:${name}:probe:true`,
      "report:Bippy instrumentation encountered an error::true",
      eventTrace(checkedOwner, `insertion-off:${value}:${count}`, snapshot, "none", snapshot, true),
      eventTrace(checkedOwner, `layout-off:${value}:${count}`, snapshot, "none", snapshot, true),
      `delete:${name}:host:true`,
      "report:Bippy instrumentation encountered an error::true",
      `ref-off:${name}:false`,
      ...(probeFirst
        ? [eventTrace(checkedOwner, sentinelReason, snapshot, "none", snapshot, true)]
        : []),
      ...commit(checkedOwner, [], false),
      eventTrace(checkedOwner, "observer", snapshot, "none", "none", false),
      `unsubscribe:${name}`,
      eventTrace(checkedOwner, `passive-off:${value}:${count}`, snapshot, "none", "none", false),
    ];
  };
  const checkIdentity = (
    checkedOwner: number,
    epoch: number,
    value: number,
    count: number,
  ): void => {
    const identity = getIdentity(checkedOwner, epoch);
    const root = harnesses[checkedOwner].getRoot();
    const current = getFiberPreorder(root.current).find((fiber) => fiber.type === ProbeBody);
    expect(getFiberById(identity.identifier)).toBe(current);
    expect(getLatestFiber(identity.fiber)).toBe(current);
    if (current?.alternate) expect(getLatestFiber(current.alternate)).toBe(current);
    expect(current?.memoizedState?.memoizedState).toBe(identity.token);
    expect(current?.memoizedState?.next?.memoizedState).toBe(count);
    expect(current?.memoizedProps.value).toBe(value);
    expect(current?.memoizedProps.epoch).toBe(epoch);
    expect(identity.host?.textContent).toBe(`${checkedOwner}:${epoch}:${value}:${count}`);
    expect(identity.host?.isConnected).toBe(true);
    expect(getFiberById(identity.hostIdentifier)).toBe(current?.child);
    const hostFiber = getFiber(identity.host);
    expect(hostFiber).not.toBeNull();
    if (hostFiber) expect(getLatestFiber(hostFiber)).toBe(current?.child);
    expect(Reflect.get(identity.cell, "impl")).toBe(
      implementations.get(`${checkedOwner}:${epoch}`),
    );
  };
  const auditPending = (count: number): EventAttempt => {
    checkIdentity(owner, 0, 0, count);
    const identity = getIdentity(owner);
    const attempt = attempts.findLast(
      (entry) => entry.owner === owner && entry.value === 1 && entry.count === count,
    );
    expect(attempt).toBeDefined();
    expect(attempt?.cell).toBe(identity.cell);
    expect(attempt?.token).toBe(identity.token);
    expect(attempt?.event).not.toBe(identity.event);
    expect(Reflect.get(identity.cell, "impl")).not.toBe(attempt?.implementation);
    if (!attempt || typeof attempt.payload !== "object" || attempt.payload === null)
      throw new Error("Missing queued effect event publication");
    expect(Reflect.get(attempt.payload, "ref")).toBe(identity.cell);
    expect(Reflect.get(attempt.payload, "nextImpl")).toBe(attempt.implementation);
    expect(getLatestFiber(attempt.fiber)).toBe(getFiberById(identity.identifier));
    expect(guardErrors).toEqual(
      new Set(["A function wrapped in useEffectEvent can't be called during rendering."]),
    );
    return attempt;
  };
  try {
    for (const checkedOwner of [0, 1]) {
      await harnesses[checkedOwner].render(jsx(App, { owner: checkedOwner }));
      checkTrace(mount(checkedOwner));
    }
    checkIdentity(owner, 0, 0, 0);
    const original = getIdentity(owner);
    await React.act(async () =>
      React.startTransition(() => setState({ epoch: 0, value: 1, revision: 0 })),
    );
    checkTrace([]);
    auditPending(0);
    notify(owner, "pending");
    checkTrace([event("pending", "0/0/0", "0/0/0", "0/0/0", true)]);
    await React.act(async () => setState((previous) => ({ ...previous, revision: 1 })));
    checkTrace([
      event("sentinel:0:0:0", "0/0/0", "0/0/0", "0/0/0", true),
      ...commit(owner),
      event("observer", "0/0/0", "0/0/0", "0/0/0", false),
    ]);
    auditPending(0);
    await React.act(async () => notify(owner, "increment", true));
    checkTrace([event("increment", "0/0/0", "0/0/0", "0/0/0", false), ...update(0, 0, 0, 1)]);
    checkIdentity(owner, 0, 0, 1);
    const suspended = auditPending(1);
    if (completes) {
      gate.ready = true;
      await React.act(async () => gate.resolve());
      checkTrace(update(0, 1, 1, 1, "sentinel:0:0:1"));
      checkIdentity(owner, 0, 1, 1);
    }
    const lastValue = completes ? 1 : 0;
    const previous = `0/${lastValue}/1`;
    const next = "1/2/0";
    const lastImplementation = Reflect.get(original.cell, "impl");
    await React.act(async () => setState({ epoch: 1, value: 2, revision: 1 }));
    checkTrace([
      `delete:${owner}:0:probe:true`,
      "report:Bippy instrumentation encountered an error::true",
      event(`insertion-off:${lastValue}:1`, previous, "none", previous, true),
      event(`layout-off:${lastValue}:1`, previous, "none", previous, true),
      `delete:${owner}:0:host:true`,
      "report:Bippy instrumentation encountered an error::true",
      `ref-off:${owner}:0:false`,
      ...(!probeFirst
        ? [event(`sentinel:0:${lastValue}:1`, previous, "none", previous, true)]
        : []),
      event("insertion-on:2:0", next, next, previous, false),
      ...(probeFirst ? [event(`sentinel:0:${lastValue}:1`, previous, "none", previous, true)] : []),
      `ref-on:${owner}:1`,
      event("layout-on:2:0", next, next, next, true),
      ...commit(owner, ["probe:mount", "host:mount"]),
      event("observer", previous, "none", next, false),
      `unsubscribe:${owner}:0`,
      event(`passive-off:${lastValue}:1`, previous, "none", next, false),
      `subscribe:${owner}:1`,
      event("passive-on:2:0", next, next, next, true),
      ...(completes ? [] : [...commit(owner), event("observer", next, next, next, true)]),
    ]);
    expect(getFiberById(original.identifier)).toBeNull();
    expect(getFiberById(original.hostIdentifier)).toBeNull();
    expect(original.host?.isConnected).toBe(false);
    expect(Reflect.get(original.cell, "impl")).toBe(lastImplementation);
    checkIdentity(owner, 1, 2, 0);
    const replacement = getIdentity(owner, 1);
    expect(replacement.token).not.toBe(original.token);
    expect(replacement.cell).not.toBe(original.cell);
    expect(replacement.event).not.toBe(original.event);
    expect(replacement.host).not.toBe(original.host);
    const attemptCount = attempts.length;
    expect(didSettle).toBe(completes);
    gate.ready = true;
    await React.act(async () => gate.resolve());
    expect(didSettle).toBe(true);
    checkTrace([]);
    expect(attempts.length).toBe(attemptCount);
    await React.act(async () => original.event("retired", true));
    checkTrace([event("retired", previous, "none", next, false)]);
    await React.act(async () => suspended.event("retired-speculative", true));
    checkTrace([event("retired-speculative", previous, "none", next, false)]);
    expect(attempts.length).toBe(attemptCount);
    checkIdentity(owner, 1, 2, 0);
    checkIdentity(1 - owner, 0, 0, 0);
    await harnesses[owner].render(null);
    checkTrace(unmount(owner, 1, 2, 0, 1));
    checkIdentity(1 - owner, 0, 0, 0);
    await harnesses[1 - owner].render(null);
    checkTrace(unmount(1 - owner, 0, 0, 0, 0));
    expect(subscriptions.size).toBe(0);
    for (const harness of harnesses) expect(_fiberRoots.has(harness.getRoot())).toBe(false);
    return [...transcript];
  } finally {
    unsubscribe();
    gate.ready = true;
    await React.act(async () => gate.resolve());
    for (const harness of harnesses) await harness.render(null);
    for (const identity of identities.values()) {
      expect(getFiberById(identity.identifier)).toBeNull();
      expect(getFiberById(identity.hostIdentifier)).toBeNull();
    }
    expect(subscriptions.size).toBe(0);
  }
};

it.each(
  [0, 1].flatMap((owner) =>
    [false, true].flatMap((probeFirst) =>
      [false, true].map((completes) => ({ owner, probeFirst, completes })),
    ),
  ),
)(
  "replays effect event publication, owner $owner, probe first $probeFirst, completes $completes",
  async (options) => {
    expect(await runEffectEvents(options)).toEqual(await runEffectEvents(options));
  },
);
