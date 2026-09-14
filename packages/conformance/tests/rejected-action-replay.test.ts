import * as React from "react";
import { jsx } from "react/jsx-runtime";
import {
  getFiber,
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  instrument,
  traverseRenderedFibers,
  type Fiber,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface RejectedActionProps {
  owner: number;
  generation: number;
}
interface RejectedBoundaryProps {
  owner: number;
}
interface RejectedBoundaryState {
  didFail: boolean;
}
interface RejectedActionInput {
  value: number;
  promise: Promise<void>;
}
interface RejectedActionControls {
  dispatch: (input: RejectedActionInput) => void;
  optimistic: (value: number) => void;
}
interface RejectedActionIdentity {
  fiber: Fiber;
  identifier: number;
  hostFiber: Fiber;
  hostIdentifier: number;
  host: HTMLSpanElement;
  token: object;
}
interface RejectedQueueNode {
  payload: unknown;
  next: unknown;
  status: unknown;
  reason: unknown;
}
interface RejectedQueue {
  dispatch: unknown;
  pending: unknown;
  action: unknown;
  state: unknown;
}
interface RejectedActionOptions {
  failedOwner: number;
  rejectsFirst: boolean;
  hasDistinctResetKey: boolean;
}

const runRejectedActions = async ({
  failedOwner,
  rejectsFirst,
  hasDistinctResetKey,
}: RejectedActionOptions): Promise<string[]> => {
  const healthyOwner = 1 - failedOwner;
  const gates = Array.from({ length: 6 }, () => Promise.withResolvers<void>());
  const firstInputs = [
    { value: 1, promise: gates[0].promise },
    { value: 2, promise: gates[1].promise },
  ];
  const queuedInput = { value: 5, promise: gates[2].promise };
  const failure = new Error("Action queue failed");
  const observerFailure = new Error("Rejected Action deletion observer failed");
  const reporterFailure = new Error("Rejected Action reporter failed");
  const controls = new Map<number, RejectedActionControls>();
  const identities = new Map<number, RejectedActionIdentity>();
  const boundaryInstances = new Map<number, React.Component>();
  const retired = new Set<number>();
  const returned = new Set<string>();
  const trace: string[] = [];
  const transcript: string[] = [];
  let isFaultArmed = true;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getName = (
    owner: number,
    generation: number,
    value: number,
    optimistic: number,
    isPending: boolean,
  ): string => `${owner}:${generation}:${value}:${optimistic}:${isPending}`;
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rejected Action rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const Probe = ({ owner, generation }: RejectedActionProps) => {
    const rendering = getRenderingFiber();
    if (!rendering) throw new Error("Missing rejected Action fiber");
    const [token] = React.useState(() => ({}));
    const identifier = getFiberId(rendering);
    const action = React.useCallback(
      async (previous: number, input: RejectedActionInput) => {
        record(
          `action-start:${owner}:${generation}:${previous}:${input.value}:${getFiberById(identifier) !== null}`,
        );
        try {
          await input.promise;
        } catch (error) {
          record(
            `action-reject:${owner}:${generation}:${input.value}:${error === failure}:${getFiberById(identifier) !== null}`,
          );
          throw error;
        }
        record(
          `action-end:${owner}:${generation}:${input.value}:${getFiberById(identifier) !== null}`,
        );
        return input.value;
      },
      [owner, generation, identifier],
    );
    const [value, dispatch, isPending] = React.useActionState(action, 0);
    const [optimistic, addOptimistic] = React.useOptimistic(
      value,
      (_previous, next: number) => next,
    );
    const hostIdentifier = React.useRef<number | null>(null);
    const getLiveness = (): string =>
      `${getFiberById(identifier) !== null}:${hostIdentifier.current !== null && getFiberById(hostIdentifier.current) !== null}`;
    const name = getName(owner, generation, value, optimistic, isPending);
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        if (!host) return;
        const hostFiber = getFiber(host);
        if (!hostFiber) throw new Error("Missing rejected Action host");
        hostIdentifier.current = getFiberId(getLatestFiber(hostFiber));
        record(`ref-on:${owner}:${generation}:${getLiveness()}`);
        return () => {
          record(`ref-off:${owner}:${generation}:${getLiveness()}`);
        };
      },
      [owner, generation, identifier],
    );
    React.useLayoutEffect(() => {
      expect(rendering.memoizedState?.memoizedState === token).toBe(true);
      record(`layout-on:${name}:${getLiveness()}`);
      return () => {
        record(`layout-off:${name}:${getLiveness()}`);
      };
    }, [name]);
    React.useEffect(() => {
      record(`passive-on:${name}:${getLiveness()}`);
      return () => {
        record(`passive-off:${name}:${getLiveness()}`);
      };
    }, [name]);
    controls.set(owner, { dispatch, optimistic: addOptimistic });
    returned.add(name);
    return jsx("span", { ref, "data-owner": owner, "data-generation": generation, children: name });
  };
  const Subscriber = React.memo(Probe);
  class Boundary extends React.Component<RejectedBoundaryProps, RejectedBoundaryState> {
    state = { didFail: false };
    static getDerivedStateFromError = (): RejectedBoundaryState => ({ didFail: true });
    componentDidMount = (): void => {
      boundaryInstances.set(this.props.owner, this);
    };
    componentDidCatch = (error: Error): void => {
      record(`boundary-caught:${this.props.owner}:${error === failure}`);
    };
    reset = (): void => {
      this.setState({ didFail: false });
    };
    render = () =>
      jsx(
        Subscriber,
        { owner: this.props.owner, generation: this.state.didFail ? 1 : 0 },
        hasDistinctResetKey ? (this.state.didFail ? "fallback" : "primary") : "stable",
      );
  }
  const harnesses = [0, 1, 2].map((owner) =>
    createRenderHarness({
      onCaughtError: (error, info) =>
        record(
          `caught:${owner}:${error === failure}:${info.errorBoundary === boundaryInstances.get(owner)}:${info.componentStack?.includes("Probe") === true}`,
        ),
    }),
  );
  const getBoundary = (owner: number): Boundary => {
    const instance = boundaryInstances.get(owner);
    if (!(instance instanceof Boundary)) throw new Error("Missing Action error boundary");
    return instance;
  };
  const getProbe = (owner: number): Fiber => {
    const fiber = getFiberPreorder(harnesses[owner].getRoot().current).find(
      (candidate) => candidate.type === Probe,
    );
    if (!fiber) throw new Error("Missing committed rejected Action fiber");
    return fiber;
  };
  const getControls = (owner: number): RejectedActionControls => {
    const controller = controls.get(owner);
    if (!controller) throw new Error("Missing rejected Action controller");
    return controller;
  };
  const getQueue = (owner: number): RejectedQueue => {
    const dispatch = getControls(owner).dispatch;
    let hook = getProbe(owner).memoizedState;
    while (hook) {
      const queue = hook.queue;
      if (
        typeof queue === "object" &&
        queue !== null &&
        "dispatch" in queue &&
        queue.dispatch === dispatch &&
        "pending" in queue &&
        "action" in queue &&
        "state" in queue
      )
        return queue;
      hook = hook.next;
    }
    throw new Error("Missing native Action queue");
  };
  const getQueueNode = (node: unknown): RejectedQueueNode => {
    if (
      typeof node !== "object" ||
      node === null ||
      !("payload" in node) ||
      !("next" in node) ||
      !("status" in node) ||
      !("reason" in node)
    )
      throw new Error("Missing native queued Action");
    return node;
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === observerFailure}`);
      throw reporterFailure;
    });
  using _fault = instrument({
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (isFaultArmed && fiber.type === Probe && fiber.memoizedProps.owner === failedOwner) {
        isFaultArmed = false;
        record(`fault:${failedOwner}`);
        throw observerFailure;
      }
    },
  });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      const owner = harnesses.findIndex(
        (harness) => "containerInfo" in root && root.containerInfo === harness.container,
      );
      if (owner === -1) return;
      const fiber = getFiberPreorder(root.current).find((candidate) => candidate.type === Probe);
      const name = harnesses[owner].container.textContent;
      record(
        fiber
          ? `commit:${name}:${getFiberById(getFiberId(fiber)) === fiber}`
          : `commit:${owner}:empty`,
      );
      traverseRenderedFibers(owner === 0 ? root.current : root, (visited, phase) => {
        if (visited.type === Probe) record(`phase:${name}:${phase}:${visited === fiber}`);
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe && fiber.type !== "span") return;
      const isProbe = fiber.type === Probe;
      const owner = Number(isProbe ? fiber.memoizedProps.owner : fiber.memoizedProps["data-owner"]);
      const generation = Number(
        isProbe ? fiber.memoizedProps.generation : fiber.memoizedProps["data-generation"],
      );
      const identity = identities.get(owner);
      if (!identity) throw new Error("Missing rejected Action deletion identity");
      record(
        `delete-${isProbe ? "probe" : "host"}:${owner}:${generation}:${getFiberById(isProbe ? identity.identifier : identity.hostIdentifier) === fiber}`,
      );
    },
  });
  const check = (owner: number, name: string): RejectedActionIdentity => {
    const fiber = getProbe(owner);
    const hostFiber = fiber.child;
    const host = hostFiber?.stateNode;
    const token = fiber.memoizedState?.memoizedState;
    if (
      !hostFiber ||
      !(host instanceof HTMLSpanElement) ||
      typeof token !== "object" ||
      token === null
    )
      throw new Error("Missing rejected Action state");
    const identifier = getFiberId(fiber);
    const hostIdentifier = getFiberId(hostFiber);
    const previous = identities.get(owner);
    if (previous) {
      expect(identifier).toBe(previous.identifier);
      expect(hostIdentifier).toBe(previous.hostIdentifier);
      expect(host === previous.host).toBe(true);
      expect(token === previous.token).toBe(true);
      expect(getLatestFiber(previous.fiber) === fiber).toBe(true);
      expect(getLatestFiber(previous.hostFiber) === hostFiber).toBe(true);
    }
    expect(getFiberById(identifier) === fiber).toBe(true);
    expect(getFiberById(hostIdentifier) === hostFiber).toBe(true);
    expect(host.textContent).toBe(name);
    expect(host.isConnected).toBe(true);
    for (const retiredIdentifier of retired) expect(getFiberById(retiredIdentifier)).toBeNull();
    const identity = previous ?? { fiber, identifier, hostFiber, hostIdentifier, host, token };
    identities.set(owner, identity);
    return identity;
  };
  const retire = (owner: number): RejectedActionIdentity => {
    const identity = identities.get(owner);
    if (!identity) throw new Error("Missing retired rejected Action");
    retired.add(identity.identifier);
    retired.add(identity.hostIdentifier);
    expect(getFiberById(identity.identifier)).toBeNull();
    expect(getFiberById(identity.hostIdentifier)).toBeNull();
    expect(getFiber(identity.host)).toBeNull();
    expect(identity.host.isConnected).toBe(false);
    identities.delete(owner);
    return identity;
  };
  const checkFresh = (
    owner: number,
    name: string,
    previous: RejectedActionIdentity,
  ): RejectedActionIdentity => {
    const next = check(owner, name);
    expect(next.identifier).not.toBe(previous.identifier);
    expect(next.hostIdentifier).not.toBe(previous.hostIdentifier);
    expect(next.host === previous.host).toBe(false);
    expect(next.token === previous.token).toBe(false);
    return next;
  };
  const getMountTrace = (owner: number, generation: number): string[] => {
    const name = getName(owner, generation, 0, 0, false);
    return [
      `ref-on:${owner}:${generation}:true:true`,
      `layout-on:${name}:true:true`,
      `commit:${name}:true`,
      `phase:${name}:mount:true`,
      `passive-on:${name}:true:true`,
    ];
  };
  const getUpdateTrace = (previous: string, next: string): string[] => [
    `layout-off:${previous}:true:true`,
    `layout-on:${next}:true:true`,
    `commit:${next}:true`,
    `phase:${next}:update:true`,
    `passive-off:${previous}:true:true`,
    `passive-on:${next}:true:true`,
  ];
  const getRemovalTrace = (owner: number, generation: number, name: string): string[] => [
    `delete-probe:${owner}:${generation}:true`,
    `layout-off:${name}:false:true`,
    `delete-host:${owner}:${generation}:true`,
    `ref-off:${owner}:${generation}:false:false`,
  ];
  const getReplacementTrace = (
    owner: number,
    previousGeneration: number,
    previousName: string,
    nextGeneration: number,
    isError: boolean,
  ): string[] => {
    const nextName = getName(owner, nextGeneration, 0, 0, false);
    return [
      ...(isError
        ? [`fault:${owner}`, "report:Bippy instrumentation encountered an error::true"]
        : []),
      ...getRemovalTrace(owner, previousGeneration, previousName),
      `ref-on:${owner}:${nextGeneration}:true:true`,
      `layout-on:${nextName}:true:true`,
      ...(isError ? [`caught:${owner}:true:true:true`, `boundary-caught:${owner}:true`] : []),
      `commit:${nextName}:true`,
      `phase:${nextName}:mount:true`,
      `passive-off:${previousName}:false:false`,
      `passive-on:${nextName}:true:true`,
    ];
  };
  const pendingNames = [0, 1].map((owner) =>
    getName(owner, 0, 0, owner === failedOwner ? 5 : 2, true),
  );
  const healthyName = getName(healthyOwner, 0, 2, 2, false);
  const fallbackName = getName(failedOwner, 1, 0, 0, false);
  const controlName = getName(2, 0, 0, 0, false);
  try {
    for (const owner of [0, 1, 2]) {
      await harnesses[owner].render(jsx(Boundary, { owner }));
      expect(trace.splice(0)).toEqual(getMountTrace(owner, 0));
      expect(returned).toEqual(new Set([getName(owner, 0, 0, 0, false)]));
      returned.clear();
      check(owner, getName(owner, 0, 0, 0, false));
    }
    const controlRoot = harnesses[2].getRoot().current;
    const boundary = getBoundary(failedOwner);
    const poisoned = getControls(failedOwner);
    for (const owner of [0, 1]) {
      const controller = getControls(owner);
      await React.act(async () =>
        React.startTransition(() => {
          controller.optimistic(owner === failedOwner ? 5 : 2);
          controller.dispatch(firstInputs[owner === failedOwner ? 0 : 1]);
          if (owner === failedOwner) controller.dispatch(queuedInput);
        }),
      );
      expect(trace.splice(0)).toEqual([
        `action-start:${owner}:0:0:${owner === failedOwner ? 1 : 2}:true`,
        ...getUpdateTrace(getName(owner, 0, 0, 0, false), pendingNames[owner]),
      ]);
      expect(returned).toEqual(new Set([pendingNames[owner]]));
      returned.clear();
      check(owner, pendingNames[owner]);
    }
    const failedQueue = getQueue(failedOwner);
    const queuedNode = getQueueNode(failedQueue.pending);
    const failedNode = getQueueNode(queuedNode.next);
    expect(queuedNode !== failedNode).toBe(true);
    expect(queuedNode.payload === queuedInput).toBe(true);
    expect(failedNode.payload === firstInputs[0]).toBe(true);
    const checkFailedQueue = (isRejected: boolean): void => {
      expect(failedQueue.dispatch === poisoned.dispatch).toBe(true);
      expect(failedQueue.state).toBe(0);
      expect(failedQueue.pending === (isRejected ? null : queuedNode)).toBe(true);
      if (isRejected) expect(failedQueue.action).toBeNull();
      else expect(typeof failedQueue.action).toBe("function");
      expect(failedNode.next === queuedNode).toBe(true);
      expect(queuedNode.next === failedNode).toBe(true);
      for (const node of [failedNode, queuedNode]) {
        expect(node.status).toBe(isRejected ? "rejected" : "pending");
        expect(node.reason === (isRejected ? failure : null)).toBe(true);
      }
    };
    checkFailedQueue(false);
    const pendingRoots = [harnesses[0].getRoot().current, harnesses[1].getRoot().current];
    const rejection = `action-reject:${failedOwner}:0:1:true:true`;
    const fulfillment = `action-end:${healthyOwner}:0:2:true`;
    await React.act(async () => {
      if (rejectsFirst) gates[0].reject(failure);
      else gates[1].resolve();
    });
    expect(trace.splice(0)).toEqual([rejectsFirst ? rejection : fulfillment]);
    expect(returned.size).toBe(0);
    expect(boundary.state.didFail).toBe(false);
    checkFailedQueue(rejectsFirst);
    expect(getQueue(healthyOwner).state).toBe(rejectsFirst ? 0 : 2);
    expect(getQueue(healthyOwner).pending === null).toBe(!rejectsFirst);
    for (const owner of [0, 1]) {
      expect(harnesses[owner].getRoot().current === pendingRoots[owner]).toBe(true);
      check(owner, pendingNames[owner]);
    }
    await React.act(async () => {
      if (rejectsFirst) gates[1].resolve();
      else gates[0].reject(failure);
    });
    expect(trace.splice(0)).toEqual([
      rejectsFirst ? fulfillment : rejection,
      ...[0, 1].flatMap((owner) =>
        owner === failedOwner
          ? getReplacementTrace(owner, 0, pendingNames[owner], 1, true)
          : getUpdateTrace(pendingNames[owner], healthyName),
      ),
    ]);
    expect(returned).toEqual(new Set([fallbackName, healthyName]));
    returned.clear();
    expect(isFaultArmed).toBe(false);
    expect(getBoundary(failedOwner) === boundary).toBe(true);
    expect(boundary.state.didFail).toBe(true);
    checkFailedQueue(true);
    const original = retire(failedOwner);
    checkFresh(failedOwner, fallbackName, original);
    check(healthyOwner, healthyName);
    check(2, controlName);
    const recovered = getControls(failedOwner);
    const recoveredQueue = getQueue(failedOwner);
    expect(recoveredQueue !== failedQueue).toBe(true);
    const afterCapture = harnesses.map((harness) => harness.getRoot().current);
    await React.act(async () => {
      gates[2].resolve();
      React.startTransition(() => poisoned.dispatch({ value: 99, promise: gates[2].promise }));
    });
    expect(trace.splice(0)).toEqual([]);
    expect(returned.size).toBe(0);
    for (const owner of [0, 1, 2])
      expect(harnesses[owner].getRoot().current === afterCapture[owner]).toBe(true);
    await React.act(async () =>
      React.startTransition(() => {
        recovered.optimistic(7);
        recovered.dispatch({ value: 7, promise: gates[3].promise });
      }),
    );
    const recoveringName = getName(failedOwner, 1, 0, 7, true);
    expect(trace.splice(0)).toEqual([
      `action-start:${failedOwner}:1:0:7:true`,
      ...getUpdateTrace(fallbackName, recoveringName),
    ]);
    expect(returned).toEqual(new Set([recoveringName]));
    returned.clear();
    check(failedOwner, recoveringName);
    await React.act(async () => gates[3].resolve());
    const recoveredName = getName(failedOwner, 1, 7, 7, false);
    expect(trace.splice(0)).toEqual([
      `action-end:${failedOwner}:1:7:true`,
      ...getUpdateTrace(recoveringName, recoveredName),
    ]);
    expect(returned).toEqual(new Set([recoveredName]));
    returned.clear();
    check(failedOwner, recoveredName);
    expect(recoveredQueue.state).toBe(7);
    expect(recoveredQueue.pending).toBeNull();
    const recoveredAction = recoveredQueue.action;
    await React.act(async () => boundary.reset());
    const resetValue = hasDistinctResetKey ? 0 : 7;
    const resetName = getName(failedOwner, 0, resetValue, resetValue, false);
    expect(trace.splice(0)).toEqual(
      hasDistinctResetKey
        ? getReplacementTrace(failedOwner, 1, recoveredName, 0, false)
        : [
            `ref-off:${failedOwner}:1:true:true`,
            `layout-off:${recoveredName}:true:true`,
            `ref-on:${failedOwner}:0:true:true`,
            `layout-on:${resetName}:true:true`,
            `commit:${resetName}:true`,
            `phase:${resetName}:update:true`,
            `passive-off:${recoveredName}:true:true`,
            `passive-on:${resetName}:true:true`,
          ],
    );
    expect(returned).toEqual(new Set([resetName]));
    returned.clear();
    expect(boundary.state.didFail).toBe(false);
    expect(getBoundary(failedOwner) === boundary).toBe(true);
    if (hasDistinctResetKey) {
      const previous = retire(failedOwner);
      const reset = checkFresh(failedOwner, resetName, previous);
      expect(reset.token === original.token).toBe(false);
      expect(reset.host === original.host).toBe(false);
    } else check(failedOwner, resetName);
    const current = getControls(failedOwner);
    const currentQueue = getQueue(failedOwner);
    expect(currentQueue === recoveredQueue).toBe(!hasDistinctResetKey);
    expect(recoveredQueue.action === recoveredAction).toBe(hasDistinctResetKey);
    expect(typeof recoveredQueue.action).toBe("function");
    checkFailedQueue(true);
    expect(current.dispatch === recovered.dispatch).toBe(!hasDistinctResetKey);
    expect(current.dispatch === poisoned.dispatch).toBe(false);
    const beforeDetached = harnesses.map((harness) => harness.getRoot().current);
    await React.act(async () =>
      React.startTransition(() => poisoned.dispatch({ value: 99, promise: gates[2].promise })),
    );
    expect(trace.splice(0)).toEqual([]);
    expect(returned.size).toBe(0);
    if (hasDistinctResetKey) {
      await React.act(async () =>
        React.startTransition(() => recovered.dispatch({ value: 9, promise: gates[4].promise })),
      );
      expect(trace.splice(0)).toEqual([`action-start:${failedOwner}:1:7:9:false`]);
      expect(returned.size).toBe(0);
    }
    for (const owner of [0, 1, 2])
      expect(harnesses[owner].getRoot().current === beforeDetached[owner]).toBe(true);
    await React.act(async () =>
      React.startTransition(() => {
        current.optimistic(11);
        current.dispatch({ value: 11, promise: gates[5].promise });
      }),
    );
    const finalPendingName = getName(failedOwner, 0, resetValue, 11, true);
    expect(trace.splice(0)).toEqual([
      `action-start:${failedOwner}:0:${resetValue}:11:true`,
      ...getUpdateTrace(resetName, finalPendingName),
    ]);
    expect(returned).toEqual(new Set([finalPendingName]));
    returned.clear();
    check(failedOwner, finalPendingName);
    const heldRoot = harnesses[failedOwner].getRoot().current;
    await React.act(async () => gates[5].resolve());
    if (hasDistinctResetKey) {
      expect(trace.splice(0)).toEqual([`action-end:${failedOwner}:0:11:true`]);
      expect(returned.size).toBe(0);
      expect(harnesses[failedOwner].getRoot().current === heldRoot).toBe(true);
      expect(currentQueue.state).toBe(11);
      expect(getQueueNode(recoveredQueue.pending).status).toBe("pending");
      check(failedOwner, finalPendingName);
      await React.act(async () => gates[4].resolve());
    }
    const finalName = getName(failedOwner, 0, 11, 11, false);
    expect(trace.splice(0)).toEqual([
      hasDistinctResetKey
        ? `action-end:${failedOwner}:1:9:false`
        : `action-end:${failedOwner}:0:11:true`,
      ...getUpdateTrace(finalPendingName, finalName),
    ]);
    expect(returned).toEqual(new Set([finalName]));
    returned.clear();
    check(failedOwner, finalName);
    expect(currentQueue.state).toBe(11);
    expect(recoveredQueue.state).toBe(hasDistinctResetKey ? 9 : 11);
    expect(recoveredQueue.pending).toBeNull();
    checkFailedQueue(true);
    check(healthyOwner, healthyName);
    check(2, controlName);
    expect(harnesses[healthyOwner].getRoot().current === afterCapture[healthyOwner]).toBe(true);
    expect(harnesses[2].getRoot().current === controlRoot).toBe(true);
    for (const owner of [0, 1, 2]) {
      const name = owner === 2 ? controlName : owner === failedOwner ? finalName : healthyName;
      await harnesses[owner].render(null);
      expect(trace.splice(0)).toEqual([
        ...getRemovalTrace(owner, 0, name),
        `commit:${owner}:empty`,
        `passive-off:${name}:false:false`,
      ]);
      expect(returned.size).toBe(0);
      retire(owner);
    }
  } finally {
    await React.act(async () => {
      for (const gate of gates) gate.resolve();
    });
  }
  expect(trace).toEqual([]);
  expect(returned.size).toBe(0);
  for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
  return transcript;
};

it.each(
  [0, 1].flatMap((failedOwner) =>
    [false, true].flatMap((rejectsFirst) =>
      [false, true].map((hasDistinctResetKey) => ({
        failedOwner,
        rejectsFirst,
        hasDistinctResetKey,
      })),
    ),
  ),
)(
  "replays rejected Action queues, owner $failedOwner, reject first $rejectsFirst, distinct reset key $hasDistinctResetKey",
  async (options) => {
    expect(await runRejectedActions(options)).toEqual(await runRejectedActions(options));
  },
);
