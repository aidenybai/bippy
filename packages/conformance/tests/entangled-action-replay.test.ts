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

interface ActionProbeProps {
  owner: number;
  generation: number;
}
interface ActionGate {
  promise: Promise<void>;
  resolve: () => void;
}
interface ActionInput {
  value: number;
  gate: ActionGate;
}
interface ActionControls {
  dispatch: (input: ActionInput) => void;
  optimistic: (value: number) => void;
  increment: () => void;
}
interface ActionAttempt {
  fiber: Fiber;
  token: object;
  current: Fiber;
  didReturn: boolean;
}
interface ActionIdentity {
  fiber: Fiber;
  identifier: number;
  hostFiber: Fiber;
  hostIdentifier: number;
  host: HTMLSpanElement;
  token: object;
}
interface EntangledActionOptions {
  firstOwner: number;
  deletion: "none" | "fulfilled" | "pending";
  queuesAction: boolean;
}

const runEntangledActions = async ({
  firstOwner,
  deletion,
  queuesAction,
}: EntangledActionOptions): Promise<string[]> => {
  const lastOwner = 1 - firstOwner;
  const deletedOwner =
    deletion === "none" ? null : deletion === "fulfilled" ? firstOwner : lastOwner;
  const harnesses = [createRenderHarness(), createRenderHarness(), createRenderHarness()];
  const gates = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
  const controls = new Map<number, ActionControls>();
  const identities = new Map<number, ActionIdentity>();
  const attempts = new Map<Fiber, ActionAttempt>();
  const returned = new Set<string>();
  const retired = new Set<number>();
  const trace: string[] = [];
  const transcript: string[] = [];
  const failure = new Error("Action commit observer failed");
  const reporterFailure = new Error("Action reporter failed");
  let failOwner: number | null = null;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing Action rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const getName = (
    owner: number,
    generation: number,
    confirmed: number,
    optimistic: number,
    isPending: boolean,
    revision = 0,
  ): string => `${owner}:${generation}:${confirmed}:${optimistic}:${isPending}:${revision}`;
  const getPendingName = (owner: number): string =>
    getName(
      owner,
      queuesAction && owner === firstOwner ? 1 : 0,
      0,
      owner + (queuesAction && owner === firstOwner ? 4 : 1),
      true,
    );
  const finalNames = [0, 1].map((owner) =>
    owner === deletedOwner
      ? getName(owner, 1, 0, 0, false)
      : getName(
          owner,
          queuesAction && owner === firstOwner ? 1 : 0,
          owner + (queuesAction && owner === firstOwner ? 4 : 1),
          owner + (queuesAction && owner === firstOwner ? 4 : 1),
          false,
        ),
  );
  const Probe = ({ owner, generation }: ActionProbeProps) => {
    const rendering = getRenderingFiber();
    if (!rendering) throw new Error("Missing Action rendering fiber");
    const [token] = React.useState(() => ({}));
    const identifier = getFiberId(rendering);
    const attempt: ActionAttempt = {
      fiber: rendering,
      token,
      current: getLatestFiber(rendering),
      didReturn: false,
    };
    attempts.set(rendering, attempt);
    const action = React.useCallback(
      async (previous: number, input: ActionInput) => {
        record(
          `action-start:${owner}:${generation}:${previous}:${input.value}:${getFiberById(identifier) !== null}`,
        );
        await input.gate.promise;
        record(
          `action-end:${owner}:${generation}:${input.value}:${getFiberById(identifier) !== null}`,
        );
        return input.value;
      },
      [owner, generation, identifier],
    );
    const [confirmed, dispatch, isPending] = React.useActionState(action, 0);
    const [optimistic, addOptimistic] = React.useOptimistic(
      confirmed,
      (_previous, next: number) => next,
    );
    const [revision, setRevision] = React.useState(0);
    const hostIdentifier = React.useRef<number | null>(null);
    const getLiveness = (): string =>
      `${getFiberById(identifier) !== null}:${hostIdentifier.current !== null && getFiberById(hostIdentifier.current) !== null}`;
    const name = getName(owner, generation, confirmed, optimistic, isPending, revision);
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        if (!host) return;
        const hostFiber = getFiber(host);
        if (!hostFiber) throw new Error("Missing Action host attachment");
        hostIdentifier.current = getFiberId(getLatestFiber(hostFiber));
        record(`ref-on:${owner}:${generation}:${getLiveness()}`);
        return () => {
          record(`ref-off:${owner}:${generation}:${getLiveness()}`);
        };
      },
      [owner, generation, identifier],
    );
    React.useLayoutEffect(() => {
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
    controls.set(owner, {
      dispatch,
      optimistic: addOptimistic,
      increment: () => setRevision((value) => value + 1),
    });
    attempt.didReturn = true;
    returned.add(name);
    return jsx("span", { ref, "data-owner": owner, "data-generation": generation, children: name });
  };
  const Subscriber = React.memo(Probe);
  const getProbe = (owner: number): Fiber => {
    const fiber = getFiberPreorder(harnesses[owner].getRoot().current).find(
      (candidate) => candidate.type === Probe,
    );
    if (!fiber) throw new Error("Missing committed Action subscriber");
    return fiber;
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === failure}`);
      throw reporterFailure;
    });
  using _fault = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (
        failOwner !== null &&
        "containerInfo" in root &&
        root.containerInfo === harnesses[failOwner].container
      ) {
        failOwner = null;
        record("fault");
        throw failure;
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
      const identity = identities.get(owner);
      if (!identity) throw new Error("Missing Action deletion identity");
      record(
        `delete-${isProbe ? "probe" : "host"}:${owner}:${getFiberById(isProbe ? identity.identifier : identity.hostIdentifier) === fiber}`,
      );
    },
  });
  const render = (owner: number, generation: number): Promise<void> =>
    harnesses[owner].render(jsx(Subscriber, { owner, generation }));
  const check = (owner: number, name: string): ActionIdentity => {
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
      throw new Error("Missing committed Action identity");
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
  const getUpdateTrace = (previous: string, next: string, hasFailure = false): string[] => [
    `layout-off:${previous}:true:true`,
    `layout-on:${next}:true:true`,
    ...(hasFailure ? ["fault", "report:Bippy instrumentation encountered an error::true"] : []),
    `commit:${next}:true`,
    `phase:${next}:update:true`,
    `passive-off:${previous}:true:true`,
    `passive-on:${next}:true:true`,
  ];
  const getDeleteTrace = (owner: number, generation: number, name: string): string[] => [
    `delete-probe:${owner}:true`,
    `layout-off:${name}:false:true`,
    `delete-host:${owner}:true`,
    `ref-off:${owner}:${generation}:false:false`,
    `commit:${owner}:empty`,
    `passive-off:${name}:false:false`,
  ];
  const resetBodies = (): void => {
    returned.clear();
    attempts.clear();
  };
  const retire = (owner: number): ActionIdentity => {
    expect(returned.size).toBe(0);
    const previous = identities.get(owner);
    if (!previous) throw new Error("Missing retired Action identity");
    retired.add(previous.identifier);
    retired.add(previous.hostIdentifier);
    expect(getFiberById(previous.identifier)).toBeNull();
    expect(getFiberById(previous.hostIdentifier)).toBeNull();
    expect(getFiber(previous.host)).toBeNull();
    expect(previous.host.isConnected).toBe(false);
    identities.delete(owner);
    return previous;
  };
  try {
    for (const owner of [0, 1, 2]) {
      await render(owner, 0);
      expect(trace.splice(0)).toEqual(getMountTrace(owner, 0));
      expect(returned).toEqual(new Set([getName(owner, 0, 0, 0, false)]));
      check(owner, getName(owner, 0, 0, 0, false));
      resetBodies();
    }
    for (const owner of [0, 1]) {
      const controller = controls.get(owner);
      if (!controller) throw new Error("Missing Action controller");
      const previousCurrent = getProbe(owner);
      await React.act(async () =>
        React.startTransition(() => {
          controller.optimistic(owner + 1);
          controller.dispatch({ value: owner + 1, gate: gates[owner] });
        }),
      );
      const name = getName(owner, 0, 0, owner + 1, true);
      expect(trace.splice(0)).toEqual([
        `action-start:${owner}:0:0:${owner + 1}:true`,
        ...getUpdateTrace(getName(owner, 0, 0, 0, false), name),
      ]);
      expect(returned).toEqual(new Set([name]));
      const current = getProbe(owner);
      const suspended = [...attempts.values()].filter((attempt) => !attempt.didReturn);
      expect(suspended.length).toBeGreaterThan(0);
      for (const attempt of attempts.values()) {
        expect(attempt.current === (attempt.didReturn ? previousCurrent : current)).toBe(true);
        expect(attempt.token === identities.get(owner)?.token).toBe(true);
        if (!attempt.didReturn) {
          expect(attempt.fiber !== current).toBe(true);
          expect(attempt.fiber.alternate === current).toBe(true);
          expect(getLatestFiber(attempt.fiber) === current).toBe(true);
        }
      }
      check(owner, name);
      resetBodies();
    }
    if (queuesAction) {
      const controller = controls.get(firstOwner);
      if (!controller) throw new Error("Missing queued Action controller");
      await React.act(async () =>
        React.startTransition(() => {
          controller.optimistic(firstOwner + 4);
          controller.dispatch({ value: firstOwner + 4, gate: gates[2] });
        }),
      );
      const queuedName = getName(firstOwner, 0, 0, firstOwner + 4, true);
      expect(trace.splice(0)).toEqual(
        getUpdateTrace(getName(firstOwner, 0, 0, firstOwner + 1, true), queuedName),
      );
      expect(returned).toEqual(new Set([queuedName]));
      resetBodies();
      check(firstOwner, queuedName);
      await render(firstOwner, 1);
      const nextName = getPendingName(firstOwner);
      expect(trace.splice(0)).toEqual([
        `ref-off:${firstOwner}:0:true:true`,
        `layout-off:${queuedName}:true:true`,
        `ref-on:${firstOwner}:1:true:true`,
        `layout-on:${nextName}:true:true`,
        `commit:${nextName}:true`,
        `phase:${nextName}:update:true`,
        `passive-off:${queuedName}:true:true`,
        `passive-on:${nextName}:true:true`,
      ]);
      expect(returned).toEqual(new Set([nextName]));
      resetBodies();
      check(firstOwner, nextName);
    }
    const pendingRoots = [harnesses[0].getRoot().current, harnesses[1].getRoot().current];
    const control = controls.get(2);
    if (!control) throw new Error("Missing independent Action control");
    await React.act(async () => control.increment());
    const controlName = getName(2, 0, 0, 0, false, 1);
    expect(trace.splice(0)).toEqual(getUpdateTrace(getName(2, 0, 0, 0, false), controlName));
    expect(returned).toEqual(new Set([controlName]));
    resetBodies();
    check(2, controlName);
    for (const owner of [0, 1])
      expect(harnesses[owner].getRoot().current === pendingRoots[owner]).toBe(true);
    await React.act(async () => gates[firstOwner].resolve());
    expect(trace.splice(0)).toEqual([
      `action-end:${firstOwner}:0:${firstOwner + 1}:true`,
      ...(queuesAction
        ? [`action-start:${firstOwner}:0:${firstOwner + 1}:${firstOwner + 4}:true`]
        : []),
    ]);
    expect(returned.size).toBe(0);
    expect(attempts.size).toBe(0);
    for (const owner of [0, 1]) {
      expect(harnesses[owner].getRoot().current === pendingRoots[owner]).toBe(true);
      check(owner, getPendingName(owner));
    }
    if (deletedOwner !== null) {
      await harnesses[deletedOwner].render(null);
      expect(trace.splice(0)).toEqual(
        getDeleteTrace(deletedOwner, 0, getName(deletedOwner, 0, 0, deletedOwner + 1, true)),
      );
      const previous = retire(deletedOwner);
      await render(deletedOwner, 1);
      expect(trace.splice(0)).toEqual(getMountTrace(deletedOwner, 1));
      expect(returned).toEqual(new Set([getName(deletedOwner, 1, 0, 0, false)]));
      const remounted = check(deletedOwner, getName(deletedOwner, 1, 0, 0, false));
      expect(remounted.identifier).not.toBe(previous.identifier);
      expect(remounted.hostIdentifier).not.toBe(previous.hostIdentifier);
      expect(remounted.host === previous.host).toBe(false);
      expect(remounted.token === previous.token).toBe(false);
      resetBodies();
    }
    const beforeCompletion = harnesses.map((harness) => harness.getRoot().current);
    const failureOwner = deletedOwner === 0 ? 1 : 0;
    failOwner = failureOwner;
    await React.act(async () => gates[lastOwner].resolve());
    if (queuesAction) {
      expect(trace.splice(0)).toEqual([`action-end:${lastOwner}:0:${lastOwner + 1}:true`]);
      expect(returned.size).toBe(0);
      expect(attempts.size).toBe(0);
      for (const owner of [0, 1]) {
        expect(harnesses[owner].getRoot().current === beforeCompletion[owner]).toBe(true);
        check(owner, getPendingName(owner));
      }
      await React.act(async () => gates[2].resolve());
    }
    const completedOwners = [0, 1].filter((owner) => owner !== deletedOwner);
    expect(trace.splice(0)).toEqual([
      queuesAction
        ? `action-end:${firstOwner}:0:${firstOwner + 4}:true`
        : `action-end:${lastOwner}:0:${lastOwner + 1}:${lastOwner !== deletedOwner}`,
      ...completedOwners.flatMap((owner) =>
        getUpdateTrace(getPendingName(owner), finalNames[owner], owner === failureOwner),
      ),
    ]);
    expect(failOwner).toBeNull();
    expect(returned).toEqual(new Set(completedOwners.map((owner) => finalNames[owner])));
    resetBodies();
    for (const owner of [0, 1]) {
      check(owner, finalNames[owner]);
      if (owner === deletedOwner)
        expect(harnesses[owner].getRoot().current === beforeCompletion[owner]).toBe(true);
    }
    expect(harnesses[2].getRoot().current === beforeCompletion[2]).toBe(true);
    check(2, controlName);
    if (queuesAction) {
      const controller = controls.get(firstOwner);
      if (!controller) throw new Error("Missing updated Action controller");
      const previousName = finalNames[firstOwner];
      const pendingName = getName(firstOwner, 1, firstOwner + 4, firstOwner + 7, true);
      const unchangedRoot = harnesses[lastOwner].getRoot().current;
      await React.act(async () =>
        React.startTransition(() => {
          controller.optimistic(firstOwner + 7);
          controller.dispatch({ value: firstOwner + 7, gate: gates[3] });
        }),
      );
      expect(trace.splice(0)).toEqual([
        `action-start:${firstOwner}:1:${firstOwner + 4}:${firstOwner + 7}:true`,
        ...getUpdateTrace(previousName, pendingName),
      ]);
      expect(returned).toEqual(new Set([pendingName]));
      expect([...attempts.values()].some((attempt) => !attempt.didReturn)).toBe(true);
      resetBodies();
      check(firstOwner, pendingName);
      await React.act(async () => gates[3].resolve());
      finalNames[firstOwner] = getName(firstOwner, 1, firstOwner + 7, firstOwner + 7, false);
      expect(trace.splice(0)).toEqual([
        `action-end:${firstOwner}:1:${firstOwner + 7}:true`,
        ...getUpdateTrace(pendingName, finalNames[firstOwner]),
      ]);
      expect(returned).toEqual(new Set([finalNames[firstOwner]]));
      resetBodies();
      check(firstOwner, finalNames[firstOwner]);
      expect(harnesses[lastOwner].getRoot().current === unchangedRoot).toBe(true);
      check(lastOwner, finalNames[lastOwner]);
      check(2, controlName);
    }
    for (const owner of [0, 1, 2]) {
      const generation = owner === deletedOwner || (queuesAction && owner === firstOwner) ? 1 : 0;
      const name = owner === 2 ? controlName : finalNames[owner];
      await harnesses[owner].render(null);
      expect(trace.splice(0)).toEqual(getDeleteTrace(owner, generation, name));
      retire(owner);
    }
    for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
  } finally {
    await React.act(async () => {
      for (const gate of gates) gate.resolve();
    });
  }
  expect(trace).toEqual([]);
  expect(returned.size).toBe(0);
  return transcript;
};

const actionSchedules: EntangledActionOptions[] = [0, 1].flatMap((firstOwner) => [
  { firstOwner, deletion: "none", queuesAction: false },
  { firstOwner, deletion: "fulfilled", queuesAction: false },
  { firstOwner, deletion: "pending", queuesAction: false },
  { firstOwner, deletion: "none", queuesAction: true },
]);
it.each(actionSchedules)(
  "replays cross-root Action entanglement, first $firstOwner, delete $deletion, queued $queuesAction",
  async (options) => {
    expect(await runEntangledActions(options)).toEqual(await runEntangledActions(options));
  },
);
