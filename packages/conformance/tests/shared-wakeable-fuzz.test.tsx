import * as React from "react";
import { createPortal } from "react-dom";
import {
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  instrument,
  traverseRenderedFibers,
  type Fiber,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface PortalState {
  value: number;
  generation: number;
  keys: string[];
}

interface SharedRootProps {
  owner: number;
}

interface SharedRowProps extends SharedRootProps {
  itemKey: string;
  value: number;
}

interface SharedIdentity {
  fiber: Fiber;
  identifier: number;
  token: number;
  host: HTMLElement;
}

interface SharedAttempt extends SharedRowProps {
  fiber: Fiber;
}

const runSharedWakeableScenario = async (seed: number): Promise<string[]> => {
  const getRandom = createSeededRandom(seed);
  const schedule = Array.from({ length: 12 }, (_, step) => {
    const deletedOwner = step % 3;
    const replacedOwner = (deletedOwner + 1 + getRandom(2)) % 3;
    return { deletedOwner, replacedOwner, survivorOwner: 3 - deletedOwner - replacedOwner };
  });
  const transcript: string[] = [];
  const record = (trace: string[], entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const harnesses = Array.from({ length: 3 }, () => createRenderHarness());
  const target = document.createElement("aside");
  const states: PortalState[] = harnesses.map(() => ({
    value: 0,
    generation: 0,
    keys: ["", "__proto__", "🧪"],
  }));
  const updates: React.Dispatch<React.SetStateAction<PortalState>>[] = [];
  const identities = harnesses.map(() => new Map<string, SharedIdentity>());
  const retired = new Set<number>();
  const effects: string[] = [];
  const phases: string[] = [];
  const unmounts: string[] = [];
  const attempts: SharedAttempt[] = [];
  let nextToken = 0;
  let pending = Promise.withResolvers<void>();
  let blockedValues = [-1, -1, -1];
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing React rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const Probe = ({ owner, itemKey, value }: SharedRowProps) => {
    const fiber = getRenderingFiber();
    if (!fiber) throw new Error("Missing render attempt");
    attempts.push({ owner, itemKey, value, fiber });
    const [token] = React.useState(() => nextToken++);
    React.useLayoutEffect(() => {
      record(effects, `on:${owner}:${itemKey}:${value}`);
      return () => {
        record(effects, `off:${owner}:${itemKey}:${value}`);
      };
    }, [owner, itemKey, value]);
    if (value === blockedValues[owner] && itemKey === "__proto__") throw pending.promise;
    return (
      <span data-owner={owner} data-key={itemKey} data-token={token}>
        {value}
      </span>
    );
  };
  const Row = React.memo(Probe);
  const App = ({ owner }: SharedRootProps) => {
    const [state, update] = React.useState(states[owner]);
    updates[owner] = update;
    return (
      <React.Suspense fallback={<b>loading</b>}>
        {createPortal(
          state.keys.map((itemKey) => (
            <Row key={itemKey} owner={owner} itemKey={itemKey} value={state.value} />
          )),
          target,
          String(state.generation),
        )}
      </React.Suspense>
    );
  };
  using _unsubscribe = instrument({
    onCommitFiberRoot: (_rendererId, root) =>
      traverseRenderedFibers(root, (fiber, phase) => {
        if (fiber.type === Probe)
          record(
            phases,
            `${phase}:${fiber.memoizedProps.owner}:${fiber.memoizedProps.itemKey}:${fiber.memoizedProps.value}`,
          );
      }),
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type === Probe)
        record(unmounts, `${fiber.memoizedProps.owner}:${fiber.memoizedProps.itemKey}`);
    },
  });
  const checkOwner = (owner: number, isPreserved: boolean, context: string) => {
    const state = states[owner];
    const fibers = getFiberPreorder(harnesses[owner].getRoot().current).filter(
      (fiber) => fiber.type === Probe,
    );
    expect(
      fibers.map((fiber) => fiber.key),
      context,
    ).toEqual(state.keys);
    const previous = identities[owner];
    const next = new Map<string, SharedIdentity>();
    for (const fiber of fibers) {
      const itemKey = fiber.key;
      const host = fiber.child?.stateNode;
      if (itemKey === null || !(host instanceof HTMLElement))
        throw new Error(`Missing row: ${context}`);
      const identifier = getFiberId(fiber);
      const token = Number(host.dataset.token);
      const old = previous.get(itemKey);
      if (isPreserved) {
        if (!old) throw new Error(`Missing retained identity: ${context}`);
        expect(identifier, context).toBe(old.identifier);
        expect(token, context).toBe(old.token);
        expect(host === old.host, context).toBe(true);
        expect(getLatestFiber(old.fiber) === fiber, context).toBe(true);
      } else if (old) {
        expect(identifier, context).not.toBe(old.identifier);
        expect(token, context).not.toBe(old.token);
        expect(host === old.host, context).toBe(false);
      }
      expect(retired.has(identifier), context).toBe(false);
      expect(getFiberById(identifier) === fiber, context).toBe(true);
      expect(getLatestFiber(fiber) === fiber, context).toBe(true);
      expect(host.textContent, context).toBe(String(state.value));
      next.set(itemKey, { fiber: isPreserved && old ? old.fiber : fiber, identifier, token, host });
    }
    for (const old of previous.values()) {
      if (![...next.values()].some((record) => record.identifier === old.identifier))
        retired.add(old.identifier);
    }
    identities[owner] = next;
    for (const identifier of retired) expect(getFiberById(identifier), context).toBeNull();
    const hosts = [...target.querySelectorAll<HTMLElement>(`[data-owner="${owner}"]`)];
    expect(
      hosts.map((host) => host.dataset.key),
      context,
    ).toEqual(state.keys);
    expect(
      new Set(
        identities.flatMap((records) => [...records.values()].map((record) => record.identifier)),
      ).size,
      context,
    ).toBe(identities.reduce((count, records) => count + records.size, 0));
  };
  for (const [owner, harness] of harnesses.entries()) {
    await harness.render(<App owner={owner} />);
    checkOwner(owner, false, `mount ${owner}`);
  }
  expect(effects.splice(0)).toEqual(
    states.flatMap((state, owner) => state.keys.map((itemKey) => `on:${owner}:${itemKey}:0`)),
  );
  expect(phases.splice(0)).toEqual(
    states.flatMap((state, owner) => state.keys.map((itemKey) => `mount:${owner}:${itemKey}:0`)),
  );
  expect(unmounts).toEqual([]);
  const exercised = harnesses.map(() => new Set<string>());

  for (const [step, { deletedOwner, replacedOwner, survivorOwner }] of schedule.entries()) {
    exercised[deletedOwner].add("delete");
    exercised[replacedOwner].add("replace");
    exercised[survivorOwner].add("survive");
    const context = JSON.stringify({ seed, step, deletedOwner, replacedOwner, survivorOwner });
    const previousStates = states.map((state) => ({ ...state, keys: [...state.keys] }));
    const roots = harnesses.map((harness) => harness.getRoot().current);
    const proposed = states.map((state) => ({
      ...state,
      value: state.value + 1,
      keys: [...state.keys].reverse(),
    }));
    pending = Promise.withResolvers<void>();
    blockedValues = proposed.map((state) => state.value);
    attempts.length = 0;
    await React.act(async () => {
      React.startTransition(() => {
        for (const [owner, update] of updates.entries()) update(proposed[owner]);
      });
    });
    for (const owner of [0, 1, 2]) {
      const suspended = attempts.find(
        (attempt) =>
          attempt.owner === owner &&
          attempt.itemKey === "__proto__" &&
          attempt.value === proposed[owner].value,
      );
      if (!suspended) throw new Error(`Root ${owner} never suspended: ${context}`);
      const old = identities[owner].get("__proto__");
      if (!old) throw new Error("Missing committed row");
      const committed = getFiberById(old.identifier);
      expect(suspended.fiber === committed, context).toBe(false);
      expect(suspended.fiber.alternate === committed, context).toBe(true);
      expect(getLatestFiber(suspended.fiber) === committed, context).toBe(true);
      expect(getFiberId(suspended.fiber), context).toBe(old.identifier);
      expect(harnesses[owner].getRoot().current === roots[owner], context).toBe(true);
      checkOwner(owner, true, context);
    }
    expect(effects, context).toEqual([]);
    expect(phases, context).toEqual([]);
    expect(unmounts, context).toEqual([]);

    await harnesses[deletedOwner].render(null);
    states[deletedOwner] = { ...proposed[deletedOwner], keys: [] };
    checkOwner(deletedOwner, false, context);
    expect(effects.splice(0), context).toEqual(
      previousStates[deletedOwner].keys.map(
        (itemKey) => `off:${deletedOwner}:${itemKey}:${previousStates[deletedOwner].value}`,
      ),
    );
    expect(unmounts.splice(0), context).toEqual(
      previousStates[deletedOwner].keys.map((itemKey) => `${deletedOwner}:${itemKey}`),
    );
    expect(phases.splice(0), context).toEqual([]);

    states[replacedOwner] = {
      ...proposed[replacedOwner],
      value: proposed[replacedOwner].value + 1,
      generation: proposed[replacedOwner].generation + 1,
    };
    await React.act(async () => updates[replacedOwner](states[replacedOwner]));
    checkOwner(replacedOwner, false, context);
    expect(effects.splice(0), context).toEqual([
      ...previousStates[replacedOwner].keys.map(
        (itemKey) => `off:${replacedOwner}:${itemKey}:${previousStates[replacedOwner].value}`,
      ),
      ...states[replacedOwner].keys.map(
        (itemKey) => `on:${replacedOwner}:${itemKey}:${states[replacedOwner].value}`,
      ),
    ]);
    expect(unmounts.splice(0), context).toEqual(
      previousStates[replacedOwner].keys.map((itemKey) => `${replacedOwner}:${itemKey}`),
    );
    expect(phases.splice(0), context).toEqual(
      states[replacedOwner].keys.map(
        (itemKey) => `mount:${replacedOwner}:${itemKey}:${states[replacedOwner].value}`,
      ),
    );
    checkOwner(survivorOwner, true, context);
    expect(harnesses[survivorOwner].getRoot().current === roots[survivorOwner], context).toBe(true);

    states[survivorOwner] = proposed[survivorOwner];
    await React.act(async () => {
      blockedValues = [-1, -1, -1];
      pending.resolve();
      await pending.promise;
    });
    for (const owner of [0, 1, 2]) checkOwner(owner, true, context);
    expect(effects.splice(0), context).toEqual([
      ...states[survivorOwner].keys.map(
        (itemKey) => `off:${survivorOwner}:${itemKey}:${previousStates[survivorOwner].value}`,
      ),
      ...states[survivorOwner].keys.map(
        (itemKey) => `on:${survivorOwner}:${itemKey}:${states[survivorOwner].value}`,
      ),
    ]);
    expect(phases.splice(0), context).toEqual(
      states[survivorOwner].keys.map(
        (itemKey) => `update:${survivorOwner}:${itemKey}:${states[survivorOwner].value}`,
      ),
    );
    expect(unmounts, context).toEqual([]);
    expect(harnesses[deletedOwner].container.childElementCount, context).toBe(0);

    states[deletedOwner] = proposed[deletedOwner];
    await harnesses[deletedOwner].render(<App owner={deletedOwner} />);
    checkOwner(deletedOwner, false, context);
    expect(effects.splice(0), context).toEqual(
      states[deletedOwner].keys.map(
        (itemKey) => `on:${deletedOwner}:${itemKey}:${states[deletedOwner].value}`,
      ),
    );
    expect(phases.splice(0), context).toEqual(
      states[deletedOwner].keys.map(
        (itemKey) => `mount:${deletedOwner}:${itemKey}:${states[deletedOwner].value}`,
      ),
    );
    expect(target.childElementCount, context).toBe(9);
  }
  for (const roles of exercised)
    expect([...roles].sort()).toEqual(["delete", "replace", "survive"]);
  for (const [owner, harness] of harnesses.entries()) {
    await harness.render(null);
    states[owner] = { ...states[owner], keys: [] };
    checkOwner(owner, false, `final cleanup ${owner}`);
  }
  expect(target.childElementCount).toBe(0);
  return transcript;
};

it.each(fuzzSeeds)(
  "replays identical shared-wakeable deletion and portal replacement traces, seed %i",
  async (seed) => {
    const first = await runSharedWakeableScenario(seed);
    const second = await runSharedWakeableScenario(seed);
    expect(second, `replay seed ${seed}`).toEqual(first);
  },
);
