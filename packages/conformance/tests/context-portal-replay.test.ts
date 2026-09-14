import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import {
  _fiberRoots,
  getFiber,
  getFiberById,
  getFiberId,
  getLatestFiber,
  getRDTHook,
  getRenderer,
  instrument,
  traverseRenderedFibers,
  type Fiber,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface ContextSample {
  name: string;
  value: number;
}
interface ContextOwnerProps {
  owner: number;
}
interface ContextProbeProps extends ContextOwnerProps {
  slot: string;
}
interface ContextProbeIdentity {
  fiber: Fiber;
  host: HTMLSpanElement;
  identifier: number;
  token: object;
  props: Fiber["memoizedProps"];
}
interface ContextOperation extends ContextOwnerProps {
  isShield: boolean;
  sample: ContextSample;
}

const runContextPortal = async (owner: number, relocatedSlot: string): Promise<string[]> => {
  const other = 1 - owner;
  const samples: readonly ContextSample[] = [
    { name: "+0", value: 0 },
    { name: "-0", value: -0 },
    { name: "nan", value: NaN },
    { name: "seven", value: 7 },
    { name: "blocked", value: 5 },
  ];
  const schedule: readonly ContextOperation[] = [
    { owner, isShield: false, sample: samples[1] },
    { owner: other, isShield: false, sample: samples[2] },
    { owner: other, isShield: false, sample: samples[2] },
    { owner, isShield: true, sample: samples[2] },
    { owner, isShield: false, sample: samples[0] },
    { owner: other, isShield: true, sample: samples[1] },
    { owner: other, isShield: false, sample: samples[0] },
    { owner, isShield: true, sample: samples[2] },
    { owner: other, isShield: true, sample: samples[0] },
  ];
  const urgentShield: ContextOperation = { owner, isShield: true, sample: samples[1] };
  const abandonedOuter: ContextOperation = { owner: other, isShield: false, sample: samples[2] };
  const slots = ["root", "portal", "shield", "shield-portal"];
  const harnesses = [createRenderHarness(), createRenderHarness()];
  const target = document.createElement("aside");
  document.body.appendChild(target);
  const context = React.createContext(999);
  const models = harnesses.map(() => ({ outer: samples[0], shield: samples[3] }));
  const outerUpdates: React.Dispatch<React.SetStateAction<ContextSample>>[] = [];
  const shieldUpdates: React.Dispatch<React.SetStateAction<ContextSample>>[] = [];
  const portalUpdates = new Map<string, React.Dispatch<React.SetStateAction<HTMLElement>>>();
  const locations = new Map<string, HTMLElement>();
  const liveOwners = new Set([0, 1]);
  const retired = new Set<number>();
  const pending = Promise.withResolvers<void>();
  let isResolved = false;
  const attempts = new Map<string, Fiber>();
  const tokens = new WeakMap<Fiber, object>();
  const bodies = new Set<string>();
  const shells = new Set<number>();
  const trace: string[] = [];
  const transcript: string[] = [];
  const original = new Map<string, ContextProbeIdentity>();
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getName = (value: unknown): string => {
    const sample = samples.find((candidate) => Object.is(candidate.value, value));
    if (!sample) throw new Error(`Unexpected context value ${String(value)}`);
    return sample.name;
  };
  const getSample = (checkedOwner: number, slot: string): ContextSample =>
    slot.startsWith("shield") ? models[checkedOwner].shield : models[checkedOwner].outer;
  const getKey = (checkedOwner: number, slot: string): string => `${checkedOwner}:${slot}`;
  const Probe = ({ owner: checkedOwner, slot }: ContextProbeProps) => {
    const value = React.useContext(context);
    const name = getName(value);
    const fiber = getRenderingFiber();
    if (!fiber) throw new Error("Missing context consumer fiber");
    const [token] = React.useState(() => ({}));
    tokens.set(fiber, token);
    const key = getKey(checkedOwner, slot);
    bodies.add(`${key}:${name}`);
    attempts.set(`${key}:${name}`, fiber);
    React.useLayoutEffect(() => {
      record(`layout-on:${key}:${name}`);
      return () => {
        record(`layout-off:${key}:${name}`);
      };
    }, [value]);
    React.useEffect(() => {
      record(`passive-on:${key}:${name}`);
      return () => {
        record(`passive-off:${key}:${name}`);
      };
    }, [value]);
    if (slot === "portal" && value === 5 && !isResolved) throw pending.promise;
    return jsx("span", { "data-owner": checkedOwner, "data-slot": slot, children: String(value) });
  };
  const Consumer = React.memo(Probe);
  const Portal = ({ owner: checkedOwner, slot }: ContextProbeProps) => {
    const [container, update] = React.useState<HTMLElement>(target);
    const child = React.useMemo(
      () => jsx(Consumer, { owner: checkedOwner, slot }),
      [checkedOwner, slot],
    );
    portalUpdates.set(getKey(checkedOwner, slot), update);
    return createPortal(child, container, "shared-key");
  };
  const shieldChildren = harnesses.map((_, checkedOwner) =>
    jsxs(React.Fragment, {
      children: [
        jsx(Consumer, { owner: checkedOwner, slot: "shield" }),
        jsx(Portal, { owner: checkedOwner, slot: "shield-portal" }),
      ],
    }),
  );
  const Shield = ({ owner: checkedOwner }: ContextOwnerProps) => {
    const [sample, update] = React.useState(samples[3]);
    shieldUpdates[checkedOwner] = update;
    return jsx(context, { value: sample.value, children: shieldChildren[checkedOwner] });
  };
  const Shell = React.memo(({ owner: checkedOwner }: ContextOwnerProps) => {
    shells.add(checkedOwner);
    return jsxs(React.Fragment, {
      children: [
        jsx(Consumer, { owner: checkedOwner, slot: "root" }),
        jsx(Portal, { owner: checkedOwner, slot: "portal" }),
        jsx(Shield, { owner: checkedOwner }),
      ],
    });
  });
  const shellChildren = harnesses.map((_, checkedOwner) =>
    jsx(React.Suspense, {
      fallback: jsx("b", { children: "unexpected loading" }),
      children: jsx(Shell, { owner: checkedOwner }),
    }),
  );
  const App = ({ owner: checkedOwner }: ContextOwnerProps) => {
    const [sample, update] = React.useState(samples[0]);
    outerUpdates[checkedOwner] = update;
    return jsx(context, { value: sample.value, children: shellChildren[checkedOwner] });
  };
  const getConsumers = (checkedOwner: number): Fiber[] =>
    getFiberPreorder(harnesses[checkedOwner].getRoot().current).filter(
      (fiber) => fiber.type === Probe,
    );
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      const checkedOwner = harnesses.findIndex(
        (harness) => "containerInfo" in root && root.containerInfo === harness.container,
      );
      if (checkedOwner === -1) return;
      record(`commit:${checkedOwner}`);
      traverseRenderedFibers(checkedOwner === owner ? root.current : root, (fiber, phase) => {
        if (fiber.type !== Probe) return;
        record(
          `phase:${fiber.memoizedProps.owner}:${fiber.memoizedProps.slot}:${getName(fiber.dependencies?.firstContext?.memoizedValue)}:${phase}`,
        );
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe) return;
      const key = `${fiber.memoizedProps.owner}:${fiber.memoizedProps.slot}`;
      const identity = original.get(key);
      if (!identity) throw new Error(`Missing deleted consumer ${key}`);
      record(`delete:${key}:${getFiberById(identity.identifier) === fiber}`);
    },
  });
  const getIdentity = (fiber: Fiber): ContextProbeIdentity => {
    const host = fiber.child?.stateNode;
    const token = tokens.get(fiber);
    if (!(host instanceof HTMLSpanElement) || !token) throw new Error("Missing mounted consumer");
    return { fiber, host, token, identifier: getFiberId(fiber), props: fiber.memoizedProps };
  };
  const checkIdentities = (): void => {
    for (const checkedOwner of liveOwners) {
      const fibers = getConsumers(checkedOwner);
      expect(fibers.map((fiber) => fiber.memoizedProps.slot)).toEqual(slots);
      for (const fiber of fibers) {
        const slot = String(fiber.memoizedProps.slot);
        const key = getKey(checkedOwner, slot);
        const identity = original.get(key);
        const host = fiber.child?.stateNode;
        if (!(host instanceof HTMLSpanElement) || !identity)
          throw new Error(`Missing consumer identity ${key}`);
        expect(getFiberId(fiber)).toBe(identity.identifier);
        expect(getFiberById(identity.identifier) === fiber).toBe(true);
        expect(getLatestFiber(identity.fiber) === fiber).toBe(true);
        expect(getLatestFiber(fiber) === fiber).toBe(true);
        expect(getRenderer(fiber) === renderer).toBe(true);
        expect(fiber.memoizedProps === identity.props).toBe(true);
        let rootFiber = fiber;
        while (rootFiber.return) rootFiber = rootFiber.return;
        expect(rootFiber.stateNode === harnesses[checkedOwner].getRoot()).toBe(true);
        expect(tokens.get(fiber) === identity.token).toBe(true);
        expect(host === identity.host).toBe(true);
        expect(getLatestFiber(getFiber(host) ?? fiber) === fiber.child).toBe(true);
        expect(getName(fiber.dependencies?.firstContext?.memoizedValue)).toBe(
          getSample(checkedOwner, slot).name,
        );
        expect(host.textContent).toBe(String(getSample(checkedOwner, slot).value));
        expect(
          host.parentElement === (locations.get(key) ?? harnesses[checkedOwner].container),
        ).toBe(true);
        expect(host.isConnected).toBe(true);
      }
    }
    expect(
      [...target.children].map(
        (host) => `${host.getAttribute("data-owner")}:${host.getAttribute("data-slot")}`,
      ),
    ).toEqual(
      [0, 1].flatMap((checkedOwner) =>
        !liveOwners.has(checkedOwner)
          ? []
          : ["portal", "shield-portal"]
              .map((slot) => getKey(checkedOwner, slot))
              .filter((key) => locations.get(key) === target),
      ),
    );
    for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
  };
  try {
    for (const checkedOwner of [0, 1]) {
      await harnesses[checkedOwner].render(jsx(App, { owner: checkedOwner }));
      const names = slots.map(
        (slot) => `${getKey(checkedOwner, slot)}:${getSample(checkedOwner, slot).name}`,
      );
      expect(trace.splice(0)).toEqual([
        ...names.map((name) => `layout-on:${name}`),
        `commit:${checkedOwner}`,
        ...names.map((name) => `phase:${name}:mount`),
        ...names.map((name) => `passive-on:${name}`),
      ]);
      expect(bodies).toEqual(new Set(names));
      bodies.clear();
      for (const fiber of getConsumers(checkedOwner)) {
        const slot = String(fiber.memoizedProps.slot);
        const key = getKey(checkedOwner, slot);
        original.set(key, getIdentity(fiber));
        if (slot.includes("portal")) locations.set(key, target);
      }
    }
    expect(shells).toEqual(new Set([0, 1]));
    shells.clear();
    checkIdentities();
    const runOperation = async (
      operation: ContextOperation,
      retriesPending = false,
      drainsPending = false,
    ): Promise<void> => {
      const model = models[operation.owner];
      const previous = operation.isShield ? model.shield : model.outer;
      const changed = previous.name !== operation.sample.name;
      const affected = changed
        ? slots.filter((slot) => slot.startsWith("shield") === operation.isShield)
        : [];
      if (operation.isShield) model.shield = operation.sample;
      else model.outer = operation.sample;
      await React.act(async () =>
        (operation.isShield ? shieldUpdates : outerUpdates)[operation.owner]({
          ...operation.sample,
        }),
      );
      expect(trace.splice(0)).toEqual([
        ...affected.map((slot) => `layout-off:${getKey(operation.owner, slot)}:${previous.name}`),
        ...affected.map(
          (slot) => `layout-on:${getKey(operation.owner, slot)}:${operation.sample.name}`,
        ),
        `commit:${operation.owner}`,
        ...affected.map(
          (slot) => `phase:${getKey(operation.owner, slot)}:${operation.sample.name}:update`,
        ),
        ...affected.map((slot) => `passive-off:${getKey(operation.owner, slot)}:${previous.name}`),
        ...affected.map(
          (slot) => `passive-on:${getKey(operation.owner, slot)}:${operation.sample.name}`,
        ),
        ...(drainsPending ? [`commit:${operation.owner}`] : []),
      ]);
      const renderedSlots = !changed
        ? []
        : operation.isShield && !retriesPending
          ? affected
          : slots;
      expect(bodies).toEqual(
        new Set(
          renderedSlots.map(
            (slot) =>
              `${getKey(operation.owner, slot)}:${retriesPending && !slot.startsWith("shield") ? "blocked" : getSample(operation.owner, slot).name}`,
          ),
        ),
      );
      bodies.clear();
      expect(shells.size).toBe(0);
      checkIdentities();
    };
    for (const operation of schedule) await runOperation(operation);
    const pendingFibers: Fiber[] = [];
    for (const checkedOwner of [0, 1]) {
      const previousRoot = harnesses[checkedOwner].getRoot().current;
      await React.act(async () =>
        React.startTransition(() => outerUpdates[checkedOwner](samples[4])),
      );
      expect(trace).toEqual([]);
      expect(harnesses[checkedOwner].getRoot().current === previousRoot).toBe(true);
      expect(bodies).toEqual(
        new Set(
          slots.map(
            (slot) =>
              `${getKey(checkedOwner, slot)}:${slot.startsWith("shield") ? models[checkedOwner].shield.name : "blocked"}`,
          ),
        ),
      );
      bodies.clear();
      const attempted = attempts.get(`${checkedOwner}:portal:blocked`);
      const identity = original.get(`${checkedOwner}:portal`);
      if (!attempted || !identity) throw new Error("Missing suspended portal consumer");
      pendingFibers[checkedOwner] = attempted;
      expect(getFiberId(attempted)).toBe(identity.identifier);
      const committed = getConsumers(checkedOwner).find(
        (fiber) => fiber.memoizedProps.slot === "portal",
      );
      expect(getLatestFiber(attempted) === committed).toBe(true);
      expect(attempted === committed).toBe(false);
      checkIdentities();
    }
    const otherRoot = harnesses[other].getRoot().current;
    await runOperation(urgentShield, true);
    expect(harnesses[other].getRoot().current === otherRoot).toBe(true);
    await runOperation(abandonedOuter, false, true);
    const abandonedRoot = harnesses[other].getRoot().current;
    await React.act(async () => {
      isResolved = true;
      pending.resolve();
      await pending.promise;
    });
    expect(harnesses[other].getRoot().current === abandonedRoot).toBe(true);
    models[owner].outer = samples[4];
    const changedNames = ["root", "portal"].map((slot) => getKey(owner, slot));
    expect(trace.splice(0)).toEqual([
      ...changedNames.map((name) => `layout-off:${name}:+0`),
      ...changedNames.map((name) => `layout-on:${name}:blocked`),
      `commit:${owner}`,
      ...changedNames.map((name) => `phase:${name}:blocked:update`),
      ...changedNames.map((name) => `passive-off:${name}:+0`),
      ...changedNames.map((name) => `passive-on:${name}:blocked`),
    ]);
    expect(bodies).toEqual(new Set(changedNames.map((name) => `${name}:blocked`)));
    bodies.clear();
    checkIdentities();
    for (const checkedOwner of [0, 1]) {
      const committed = getConsumers(checkedOwner).find(
        (fiber) => fiber.memoizedProps.slot === "portal",
      );
      expect(getLatestFiber(pendingFibers[checkedOwner]) === committed).toBe(true);
    }
    const relocatedKey = getKey(owner, relocatedSlot);
    const previousIdentity = original.get(relocatedKey);
    const relocate = portalUpdates.get(relocatedKey);
    if (!previousIdentity || !relocate) throw new Error("Missing relocation target");
    const relocatedName = `${relocatedKey}:${getSample(owner, relocatedSlot).name}`;
    const previousOtherRoot = harnesses[other].getRoot().current;
    locations.set(relocatedKey, harnesses[other].container);
    await React.act(async () => relocate(harnesses[other].container));
    expect(trace.splice(0)).toEqual([
      `delete:${relocatedKey}:true`,
      `layout-off:${relocatedName}`,
      `layout-on:${relocatedName}`,
      `commit:${owner}`,
      `phase:${relocatedName}:mount`,
      `passive-off:${relocatedName}`,
      `passive-on:${relocatedName}`,
    ]);
    expect(bodies).toEqual(new Set([relocatedName]));
    bodies.clear();
    expect(harnesses[other].getRoot().current === previousOtherRoot).toBe(true);
    const relocated = getConsumers(owner).find(
      (fiber) => fiber.memoizedProps.slot === relocatedSlot,
    );
    if (!relocated) throw new Error("Missing relocated consumer");
    const nextIdentity = getIdentity(relocated);
    expect(nextIdentity.identifier).not.toBe(previousIdentity.identifier);
    expect(nextIdentity.fiber === previousIdentity.fiber).toBe(false);
    expect(nextIdentity.host === previousIdentity.host).toBe(false);
    expect(nextIdentity.token === previousIdentity.token).toBe(false);
    expect(previousIdentity.host.isConnected).toBe(false);
    expect(getFiber(previousIdentity.host)).toBeNull();
    original.set(relocatedKey, nextIdentity);
    retired.add(previousIdentity.identifier);
    checkIdentities();
    for (const checkedOwner of [other, owner]) {
      await harnesses[checkedOwner].render(null);
      const names = slots.map(
        (slot) => `${getKey(checkedOwner, slot)}:${getSample(checkedOwner, slot).name}`,
      );
      expect(trace.splice(0)).toEqual([
        ...names.flatMap((name, index) => [
          `delete:${getKey(checkedOwner, slots[index])}:true`,
          `layout-off:${name}`,
        ]),
        `commit:${checkedOwner}`,
        ...names.map((name) => `passive-off:${name}`),
      ]);
      for (const [key, identity] of original) {
        if (!key.startsWith(`${checkedOwner}:`)) continue;
        expect(getFiberById(identity.identifier)).toBeNull();
        expect(getFiber(identity.host)).toBeNull();
        expect(identity.host.isConnected).toBe(false);
        retired.add(identity.identifier);
      }
      liveOwners.delete(checkedOwner);
      expect(_fiberRoots.has(harnesses[checkedOwner].getRoot())).toBe(false);
      checkIdentities();
      if (checkedOwner === other) {
        expect(_fiberRoots.has(harnesses[owner].getRoot())).toBe(true);
        expect(harnesses[other].container.firstChild === nextIdentity.host).toBe(true);
        expect(harnesses[other].container.childNodes).toHaveLength(1);
      }
    }
    expect(shells.size).toBe(0);
    expect(bodies.size).toBe(0);
    expect(target.children).toHaveLength(0);
    return transcript;
  } finally {
    target.remove();
  }
};

it.each(
  [0, 1].flatMap((owner) =>
    ["portal", "shield-portal"].map((relocatedSlot) => ({ owner, relocatedSlot })),
  ),
)(
  "replays context propagation, suspended updates and foreign-root portal relocation, owner $owner, slot $relocatedSlot",
  async ({ owner, relocatedSlot }) => {
    expect(await runContextPortal(owner, relocatedSlot)).toEqual(
      await runContextPortal(owner, relocatedSlot),
    );
  },
);
