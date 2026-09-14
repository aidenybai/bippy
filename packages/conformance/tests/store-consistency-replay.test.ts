import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
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
import { expect, it, vi, type Mock } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface ConsistencyReader {
  getSnapshot: Mock<() => number>;
  subscribe: (listener: () => void) => () => void;
}
interface ConsistencyStore {
  name: string;
  value: number;
  failure: Error;
  listeners: Map<() => void, string>;
  readers: Map<string, ConsistencyReader>;
  publish: (value: number) => void;
}
interface ConsistencyStoreProps {
  store: ConsistencyStore;
}
interface ConsistencyState extends ConsistencyStoreProps {
  keys: string[];
}
interface ConsistencyStep extends ConsistencyState {
  value: number;
}
interface ConsistencyProbeProps extends ConsistencyStoreProps {
  name: string;
}
interface ConsistencyAttempt extends ConsistencyProbeProps {
  fiber: Fiber;
  value: number;
  token: object;
}
interface ConsistencyIdentity {
  fiber: Fiber;
  host: HTMLSpanElement;
  identifier: number;
  token: object;
}
interface ConsistencyOptions {
  hasExistingReaders: boolean;
  throwsDuringValidation: boolean;
  isReversed: boolean;
}

const runStoreConsistency = async ({
  hasExistingReaders,
  throwsDuringValidation,
  isReversed,
}: ConsistencyOptions): Promise<string[]> => {
  const caught: unknown[] = [];
  const harness = createRenderHarness({
    onCaughtError: (error) => {
      caught.push(error);
    },
  });
  const control = createRenderHarness();
  const trace: string[] = [];
  const transcript: string[] = [];
  const bodies = new Set<string>();
  const attempts: ConsistencyAttempt[] = [];
  const latestAttempts = new WeakMap<Fiber, ConsistencyAttempt>();
  const identities = new Map<string, ConsistencyIdentity>();
  const retired = new Set<number>();
  const anchorBodies = new Set<string>();
  let activeStore: ConsistencyStore | null = null;
  let currentBeforeAttempt: Fiber | null = null;
  let hasPublished = false;
  let hasCommitted = true;
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  using _console = vi.spyOn(console, "error").mockImplementation(() => {});
  const createStore = (name: string): ConsistencyStore => {
    const store: ConsistencyStore = {
      name,
      value: 0,
      failure: new Error(`validation failed:${name}`),
      listeners: new Map(),
      readers: new Map(),
      publish: (value) => {
        store.value = value;
        record(`publish:${name}:${value}:${store.listeners.size}`);
        for (const [listener, readerName] of store.listeners) {
          record(`notify:${name}:${readerName}`);
          listener();
        }
      },
    };
    for (const readerName of ["a", "b", "c", "control"]) {
      store.readers.set(readerName, {
        getSnapshot: vi.fn(() => {
          if (
            store === activeStore &&
            hasPublished &&
            !hasCommitted &&
            getRenderingFiber() === null
          ) {
            expect(harness.getRoot().current === currentBeforeAttempt).toBe(true);
            expect(store.listeners.size).toBe(0);
            record(
              `validate:${name}:${readerName}:${throwsDuringValidation ? "throw" : store.value}`,
            );
            for (const [key, identity] of identities) {
              if (key === "control") continue;
              const current = getFiberPreorder(harness.getRoot().current).find(
                (fiber) => fiber.type === Probe && fiber.memoizedProps.name === key,
              );
              expect(getFiberById(identity.identifier) === current).toBe(true);
              const attempted = attempts.find(
                (candidate) => candidate.store === store && candidate.name === key,
              );
              if (!attempted) throw new Error(`Missing pre-commit attempt ${key}`);
              expect(attempted.fiber !== current).toBe(true);
              expect(getLatestFiber(attempted.fiber) === current).toBe(true);
            }
            if (throwsDuringValidation) throw store.failure;
          }
          return store.value;
        }),
        subscribe: (listener) => {
          record(`subscribe:${name}:${readerName}`);
          expect(store.listeners.has(listener)).toBe(false);
          store.listeners.set(listener, readerName);
          return () => {
            record(`unsubscribe:${name}:${readerName}`);
            expect(store.listeners.get(listener)).toBe(readerName);
            store.listeners.delete(listener);
          };
        },
      });
    }
    return store;
  };
  const stores = [
    createStore("initial"),
    createStore("first"),
    createStore("second"),
    createStore("control"),
  ];
  const initialKeys = hasExistingReaders ? ["a", "b", "c"] : [];
  const firstKeys = isReversed ? ["c", "b", "a"] : ["a", "b", "c"];
  const secondKeys = [firstKeys[1], firstKeys[2], firstKeys[0]];
  const schedule: readonly ConsistencyStep[] = [
    { store: stores[1], keys: firstKeys, value: 1 },
    { store: stores[2], keys: secondKeys, value: 2 },
  ];
  const getReader = (store: ConsistencyStore, name: string): ConsistencyReader => {
    const reader = store.readers.get(name);
    if (!reader) throw new Error(`Missing reader ${name}`);
    return reader;
  };
  const Probe = ({ name, store }: ConsistencyProbeProps) => {
    const reader = getReader(store, name);
    const value = React.useSyncExternalStore(reader.subscribe, reader.getSnapshot);
    const [token] = React.useState(() => ({}));
    const fiber = getRenderingFiber();
    if (!fiber) throw new Error("Missing store rendering fiber");
    const attempt = { name, store, value, fiber, token };
    attempts.push(attempt);
    latestAttempts.set(fiber, attempt);
    const label = `${name}:${store.name}:${value}`;
    bodies.add(label);
    React.useLayoutEffect(() => {
      const identifier = getFiberId(fiber);
      record(`layout-on:${label}:${getLatestFiber(fiber) === fiber}`);
      return () => {
        record(`layout-off:${label}:${getFiberById(identifier) === null}`);
      };
    }, [store, value]);
    React.useEffect(() => {
      record(`passive-on:${label}`);
      return () => {
        record(`passive-off:${label}`);
      };
    }, [store, value]);
    return jsx("span", { "data-reader": name, children: label });
  };
  const Reader = React.memo(Probe);
  const Anchor = React.memo(() => {
    anchorBodies.add("anchor");
    return jsx("mark", { children: "anchor" });
  });
  const Interleave = ({ store }: ConsistencyStoreProps) => {
    if (store === activeStore && !hasPublished) {
      hasPublished = true;
      expect(store.listeners.size).toBe(0);
      // HACK: Publish between readers to isolate the pre-commit check without scheduler timing.
      store.publish(store === stores[1] ? 1 : 2);
    }
    return null;
  };
  let update: React.Dispatch<React.SetStateAction<ConsistencyState>> = () => {
    throw new Error("App has not mounted");
  };
  const App = () => {
    const [state, setState] = React.useState<ConsistencyState>({
      store: stores[0],
      keys: initialKeys,
    });
    update = setState;
    React.useLayoutEffect(() => {
      record(
        `layout-tree:${[...harness.container.querySelectorAll("span")].map((host) => host.textContent).join(",")}`,
      );
    });
    return jsxs(React.Fragment, {
      children: [
        jsx(Anchor, {}),
        state.keys.flatMap((name, index) => [
          jsx(Reader, { name, store: state.store }, name),
          ...(index === 1 ? [jsx(Interleave, { store: state.store }, "interleave")] : []),
        ]),
      ],
    });
  };
  const getRows = (root: Fiber): Fiber[] =>
    getFiberPreorder(root).filter((fiber) => fiber.type === Probe);
  const getAttempt = (fiber: Fiber): ConsistencyAttempt => {
    const attempt =
      latestAttempts.get(fiber) ??
      (fiber.alternate ? latestAttempts.get(fiber.alternate) : undefined);
    if (!attempt) throw new Error("Missing committed store snapshot");
    return attempt;
  };
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (!("containerInfo" in root) || root.containerInfo !== harness.container) return;
      hasCommitted = true;
      const rows = getRows(root.current);
      record(
        `commit:${rows
          .map((fiber) => {
            const attempt = getAttempt(fiber);
            return `${attempt.name}:${attempt.store.name}:${attempt.value}`;
          })
          .join(",")}`,
      );
      traverseRenderedFibers(isReversed ? root.current : root, (fiber, phase) => {
        if (fiber.elementType === Anchor) record(`phase:anchor:${phase}`);
        if (fiber.type !== Probe) return;
        const attempt = getAttempt(fiber);
        record(`phase:${attempt.name}:${attempt.store.name}:${attempt.value}:${phase}`);
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe) return;
      const name = String(fiber.memoizedProps.name);
      const identity = identities.get(name);
      if (!identity) throw new Error(`Missing deletion identity ${name}`);
      record(`delete:${name}:${getFiberById(identity.identifier) === fiber}`);
    },
  });
  const check = (state: ConsistencyState, expectedValue: number): void => {
    const rows = getRows(harness.getRoot().current);
    expect(rows.map((fiber) => fiber.memoizedProps.name)).toEqual(state.keys);
    for (const fiber of [...rows, ...getRows(control.getRoot().current)]) {
      const attempt = getAttempt(fiber);
      const host = fiber.child?.stateNode;
      if (!(host instanceof HTMLSpanElement)) throw new Error("Missing committed store host");
      const identifier = getFiberId(fiber);
      const previous = identities.get(attempt.name);
      if (previous) {
        expect(identifier).toBe(previous.identifier);
        expect(host === previous.host).toBe(true);
        expect(attempt.token === previous.token).toBe(true);
        expect(getLatestFiber(previous.fiber) === fiber).toBe(true);
      } else identities.set(attempt.name, { fiber, host, identifier, token: attempt.token });
      expect(getFiberById(identifier) === fiber).toBe(true);
      expect(getLatestFiber(fiber) === fiber).toBe(true);
      expect(attempt.store === (attempt.name === "control" ? stores[3] : state.store)).toBe(true);
      expect(attempt.value).toBe(attempt.name === "control" ? 0 : expectedValue);
      expect(host.textContent).toBe(`${attempt.name}:${attempt.store.name}:${attempt.value}`);
      expect(host.isConnected).toBe(true);
    }
    expect(
      [...harness.container.querySelectorAll("span")].map((host) => host.dataset.reader),
    ).toEqual(state.keys);
    for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
    expect(stores.map((store) => store.listeners.size)).toEqual(
      stores.map((store) =>
        store === stores[3] ? 1 : store === state.store ? state.keys.length : 0,
      ),
    );
  };
  const getCommit = (
    state: ConsistencyState,
    expectedValue: number,
    phase: string,
    hasParentLayout = true,
  ): string[] => {
    const labels = state.keys.map((name) => `${name}:${state.store.name}:${expectedValue}`);
    return [
      ...(hasParentLayout ? [`layout-tree:${labels.join(",")}`] : []),
      `commit:${labels.join(",")}`,
      ...(state.store === stores[0] ? ["phase:anchor:mount"] : []),
      ...labels.map((label) => `phase:${label}:${phase}`),
    ];
  };
  await control.render(jsx(Reader, { name: "control", store: stores[3] }));
  expect(trace.splice(0)).toEqual([
    "layout-on:control:control:0:true",
    "subscribe:control:control",
    "passive-on:control:control:0",
  ]);
  expect(bodies).toEqual(new Set(["control:control:0"]));
  bodies.clear();
  await harness.render(jsx(App, {}));
  expect(trace.splice(0)).toEqual([
    ...initialKeys.map((name) => `layout-on:${name}:initial:0:true`),
    ...getCommit({ store: stores[0], keys: initialKeys }, 0, "mount"),
    ...initialKeys.flatMap((name) => [`subscribe:initial:${name}`, `passive-on:${name}:initial:0`]),
  ]);
  expect(bodies).toEqual(new Set(initialKeys.map((name) => `${name}:initial:0`)));
  bodies.clear();
  expect(anchorBodies).toEqual(new Set(["anchor"]));
  anchorBodies.clear();
  check({ store: stores[0], keys: initialKeys }, 0);
  const anchorHost = harness.container.querySelector("mark");
  const anchorFiber = getFiberPreorder(harness.getRoot().current).find(
    (fiber) => fiber.elementType === Anchor,
  );
  if (!anchorHost || !anchorFiber) throw new Error("Missing committed anchor");
  const anchorIdentifier = getFiberId(anchorFiber);
  let previousStore = stores[0];
  let previousKeys = initialKeys;
  let previousValue = 0;
  for (const state of schedule) {
    activeStore = state.store;
    currentBeforeAttempt = harness.getRoot().current;
    hasPublished = false;
    hasCommitted = false;
    await React.act(async () => React.startTransition(() => update(state)));
    expect(trace.splice(0)).toEqual([
      `publish:${state.store.name}:${state.value}:0`,
      `validate:${state.store.name}:${state.keys[0]}:${throwsDuringValidation ? "throw" : state.value}`,
      ...state.keys
        .filter((name) => previousKeys.includes(name))
        .map((name) => `layout-off:${name}:${previousStore.name}:${previousValue}:false`),
      ...state.keys.map((name) => `layout-on:${name}:${state.store.name}:${state.value}:true`),
      ...getCommit(state, state.value, previousKeys.length === 0 ? "mount" : "update"),
      ...state.keys
        .filter((name) => previousKeys.includes(name))
        .flatMap((name) => [
          `unsubscribe:${previousStore.name}:${name}`,
          `passive-off:${name}:${previousStore.name}:${previousValue}`,
        ]),
      ...state.keys.flatMap((name) => [
        `subscribe:${state.store.name}:${name}`,
        `passive-on:${name}:${state.store.name}:${state.value}`,
      ]),
    ]);
    expect(bodies).toEqual(
      new Set(
        state.keys.flatMap((name, index) => [
          ...(index < 2 ? [`${name}:${state.store.name}:0`] : []),
          `${name}:${state.store.name}:${state.value}`,
        ]),
      ),
    );
    bodies.clear();
    for (const name of state.keys) {
      const current = getRows(harness.getRoot().current).find(
        (fiber) => fiber.memoizedProps.name === name,
      );
      const firstAttempt = attempts.find(
        (attempt) => attempt.store === state.store && attempt.name === name,
      );
      if (!current || !firstAttempt) throw new Error("Missing consistency retry");
      if (previousKeys.length) {
        expect(current === firstAttempt.fiber).toBe(true);
        expect(getLatestFiber(firstAttempt.fiber) === current).toBe(true);
      } else {
        expect(current === firstAttempt.fiber).toBe(false);
        expect(getAttempt(current).token === firstAttempt.token).toBe(false);
      }
      const reader = getReader(state.store, name);
      const thrown = reader.getSnapshot.mock.results.filter((result) => result.type === "throw");
      expect(thrown).toHaveLength(throwsDuringValidation && name === state.keys[0] ? 1 : 0);
      for (const result of thrown) expect(result.value).toBe(state.store.failure);
    }
    check(state, state.value);
    expect(harness.container.querySelector("mark") === anchorHost).toBe(true);
    const currentAnchor = getFiberPreorder(harness.getRoot().current).find(
      (fiber) => fiber.elementType === Anchor,
    );
    expect(getLatestFiber(anchorFiber) === currentAnchor).toBe(true);
    expect(getFiberById(anchorIdentifier) === currentAnchor).toBe(true);
    expect(anchorBodies.size).toBe(0);
    previousStore = state.store;
    previousKeys = state.keys;
    previousValue = state.value;
  }
  const finalState = schedule[1];
  await React.act(async () => finalState.store.publish(3));
  expect(trace.splice(0)).toEqual([
    "publish:second:3:3",
    ...secondKeys.map((name) => `notify:second:${name}`),
    ...secondKeys.map((name) => `layout-off:${name}:second:2:false`),
    ...secondKeys.map((name) => `layout-on:${name}:second:3:true`),
    ...getCommit(finalState, 3, "update", false),
    ...secondKeys.map((name) => `passive-off:${name}:second:2`),
    ...secondKeys.map((name) => `passive-on:${name}:second:3`),
  ]);
  expect(bodies).toEqual(new Set(secondKeys.map((name) => `${name}:second:3`)));
  bodies.clear();
  check(finalState, 3);
  await harness.render(null);
  expect(trace.splice(0)).toEqual([
    ...secondKeys.flatMap((name) => [`delete:${name}:true`, `layout-off:${name}:second:3:true`]),
    "commit:",
    ...secondKeys.flatMap((name) => [`unsubscribe:second:${name}`, `passive-off:${name}:second:3`]),
  ]);
  for (const name of secondKeys) {
    const identity = identities.get(name);
    if (!identity) throw new Error("Missing final identity");
    retired.add(identity.identifier);
    expect(getFiber(identity.host)).toBeNull();
    expect(identity.host.isConnected).toBe(false);
  }
  check({ store: finalState.store, keys: [] }, 3);
  expect(getFiberById(anchorIdentifier)).toBeNull();
  expect(anchorHost.isConnected).toBe(false);
  await control.render(null);
  expect(trace.splice(0)).toEqual([
    "delete:control:true",
    "layout-off:control:control:0:true",
    "unsubscribe:control:control",
    "passive-off:control:control:0",
  ]);
  for (const identity of identities.values()) expect(getFiberById(identity.identifier)).toBeNull();
  expect(stores.every((store) => store.listeners.size === 0)).toBe(true);
  expect(caught).toEqual([]);
  expect(_console).not.toHaveBeenCalled();
  return transcript;
};

it.each(
  [false, true].flatMap((hasExistingReaders) =>
    [false, true].flatMap((throwsDuringValidation) =>
      [false, true].map((isReversed) => ({
        hasExistingReaders,
        throwsDuringValidation,
        isReversed,
      })),
    ),
  ),
)(
  "replays store consistency retries, existing $hasExistingReaders, validation throws $throwsDuringValidation, reverse $isReversed",
  async (options) => {
    expect(await runStoreConsistency(options)).toEqual(await runStoreConsistency(options));
  },
);
