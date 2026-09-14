import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  _fiberRoots,
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

interface CascadeState {
  visible: boolean;
  value: number;
}

interface CascadeStore {
  getSnapshot: () => CascadeState;
  subscribe: (listener: () => void) => () => void;
  publish: (snapshot: CascadeState) => void;
  getSubscriptionCount: () => number;
  getPublishCount: () => number;
}

const createCascadeStore = (): CascadeStore => {
  let snapshot: CascadeState = Object.freeze({ visible: true, value: 0 });
  let publishCount = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (nextSnapshot) => {
      snapshot = Object.freeze(nextSnapshot);
      publishCount++;
      for (const listener of listeners) listener();
    },
    getSubscriptionCount: () => listeners.size,
    getPublishCount: () => publishCount,
  };
};

interface CascadeOwnerProps {
  owner: number;
}

interface CascadeProbeProps extends CascadeOwnerProps {
  value: number;
}

const runCleanupCascade = async (
  initiator: number,
  isPassiveStore: boolean,
  hasFeedback: boolean,
): Promise<string[]> => {
  const receiver = 1 - initiator;
  const harnesses = [createRenderHarness(), createRenderHarness()];
  const updates: React.Dispatch<React.SetStateAction<CascadeState>>[] = [];
  const stores = [createCascadeStore(), createCascadeStore()];
  const identifiers = new Map<string, number>();
  const transcript: string[] = [];
  const trace: string[] = [];
  const failures: unknown[] = [];
  const postFailure = new Error("post-commit observer failed");
  const deletionFailure = new Error("deletion observer failed");
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const Probe = ({ owner, value }: CascadeProbeProps) => {
    const rendering = getRenderingFiber();
    if (!rendering) throw new Error("Missing rendering fiber");
    let identifier = -1;
    React.useLayoutEffect(() => {
      identifier = getFiberId(rendering);
      identifiers.set(`${owner}:${value}`, identifier);
      record(`layout-on:${owner}:${value}:${getLatestFiber(rendering) === rendering}`);
      if (owner === receiver && value === 1 && !isPassiveStore) {
        record(`queue:${initiator}:2`);
        updates[initiator]({ visible: true, value: 2 });
      }
      return () => {
        record(`layout-off:${owner}:${value}:${getFiberById(identifier) === null}`);
      };
    }, [owner, value]);
    React.useEffect(() => {
      record(`passive-on:${owner}:${value}`);
      if (owner === receiver && value === 1 && isPassiveStore) {
        record(`queue:${initiator}:2`);
        stores[initiator].publish({ visible: true, value: 2 });
      }
      if (owner === initiator && value === 2 && hasFeedback) {
        record(`queue:${receiver}:3`);
        stores[receiver].publish({ visible: true, value: 3 });
      }
      return () => {
        record(`passive-off:${owner}:${value}:${getFiberById(identifier) === null}`);
        if (owner === initiator && value === 0) {
          record(`queue:${receiver}:1`);
          updates[receiver]({ visible: true, value: 1 });
        }
      };
    }, [owner, value]);
    return jsxs("span", { children: [owner, ":", value] });
  };
  const App = ({ owner }: CascadeOwnerProps) => {
    const [state, update] = React.useState<CascadeState>({ visible: true, value: 0 });
    updates[owner] = update;
    const snapshot = React.useSyncExternalStore(stores[owner].subscribe, stores[owner].getSnapshot);
    const currentState =
      isPassiveStore && (owner === initiator || snapshot.value > state.value) ? snapshot : state;
    return currentState.visible ? jsx(Probe, { owner, value: currentState.value }) : null;
  };
  const getOwner = (root: FiberRoot): number =>
    harnesses.findIndex(
      (harness) => "containerInfo" in root && root.containerInfo === harness.container,
    );
  const getProbe = (root: FiberRoot): Fiber | undefined =>
    getFiberPreorder(root.current).find((fiber) => fiber.type === Probe);
  const getValue = (root: FiberRoot): string =>
    String(getProbe(root)?.memoizedProps.value ?? "empty");
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((_message: unknown, error: unknown) => {
      failures.push(error);
      record(
        `report:${error === postFailure ? "post" : error === deletionFailure ? "delete" : "unknown"}`,
      );
      throw new Error("cascade reporter failed");
    });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      const owner = getOwner(root);
      if (owner === -1) return;
      record(`commit:${owner}:${getValue(root)}:${_fiberRoots.has(root)}`);
      traverseRenderedFibers(isPassiveStore ? root.current : root, (fiber, phase) => {
        if (fiber.type === Probe) record(`phase:${owner}:${fiber.memoizedProps.value}:${phase}`);
        else if (fiber.tag === getReactWorkTags().HostRoot && phase === "unmount")
          record(`phase:${owner}:root:unmount`);
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type !== Probe) return;
      const { owner, value } = fiber.memoizedProps;
      const identifier = identifiers.get(`${owner}:${value}`);
      record(
        `delete:${owner}:${value}:${identifier !== undefined && getFiberById(identifier) === fiber}`,
      );
      throw deletionFailure;
    },
    onPostCommitFiberRoot: (_rendererId, root) => {
      const owner = getOwner(root);
      if (owner === -1) return;
      record(`post:${owner}:${getValue(root)}`);
      throw postFailure;
    },
  });
  using _later = instrument({
    onPostCommitFiberRoot: (_rendererId, root) => {
      const owner = getOwner(root);
      if (owner === -1) return;
      const probe = getProbe(root);
      const identifier = probe
        ? identifiers.get(`${owner}:${probe.memoizedProps.value}`)
        : undefined;
      record(
        `later-post:${owner}:${probe ? identifier !== undefined && getFiberById(identifier) === probe : true}`,
      );
    },
  });
  for (const owner of [0, 1]) {
    await harnesses[owner].render(jsx(App, { owner }));
    expect(trace.splice(0)).toEqual([
      `layout-on:${owner}:0:true`,
      `commit:${owner}:0:true`,
      `phase:${owner}:0:mount`,
      `passive-on:${owner}:0`,
      `post:${owner}:0`,
      "report:post",
      `later-post:${owner}:true`,
    ]);
  }
  const originals = harnesses.map((harness) => {
    const probe = getProbe(harness.getRoot());
    if (!probe) throw new Error("Missing initial probe");
    return probe;
  });
  const originalIdentifiers = originals.map(getFiberId);
  expect(stores.map((store) => store.getSubscriptionCount())).toEqual([1, 1]);
  await React.act(async () => {
    const state = { visible: false, value: 0 };
    if (isPassiveStore) stores[initiator].publish(state);
    else updates[initiator](state);
  });
  expect(trace.splice(0)).toEqual([
    `delete:${initiator}:0:true`,
    "report:delete",
    `layout-off:${initiator}:0:true`,
    `commit:${initiator}:empty:true`,
    `passive-off:${initiator}:0:true`,
    `queue:${receiver}:1`,
    `post:${initiator}:empty`,
    "report:post",
    `later-post:${initiator}:true`,
    `layout-off:${receiver}:0:false`,
    `layout-on:${receiver}:1:true`,
    ...(!isPassiveStore ? [`queue:${initiator}:2`] : []),
    `commit:${receiver}:1:true`,
    `phase:${receiver}:1:update`,
    `passive-off:${receiver}:0:false`,
    `passive-on:${receiver}:1`,
    ...(isPassiveStore
      ? [`queue:${initiator}:2`]
      : [`post:${receiver}:1`, "report:post", `later-post:${receiver}:true`]),
    `layout-on:${initiator}:2:true`,
    `commit:${initiator}:2:true`,
    `phase:${initiator}:2:mount`,
    `passive-on:${initiator}:2`,
    ...(hasFeedback ? [`queue:${receiver}:3`] : []),
    `post:${initiator}:2`,
    "report:post",
    `later-post:${initiator}:true`,
    ...(hasFeedback
      ? [
          `layout-off:${receiver}:1:false`,
          `layout-on:${receiver}:3:true`,
          `commit:${receiver}:3:true`,
          `phase:${receiver}:3:update`,
          `passive-off:${receiver}:1:false`,
          `passive-on:${receiver}:3`,
          `post:${receiver}:3`,
          "report:post",
          `later-post:${receiver}:true`,
        ]
      : []),
    ...(isPassiveStore
      ? [`post:${receiver}:${hasFeedback ? 3 : 1}`, "report:post", `later-post:${receiver}:true`]
      : []),
  ]);
  expect(stores.map((store) => store.getPublishCount())).toEqual(
    [0, 1].map((owner) => (owner === initiator ? (isPassiveStore ? 2 : 0) : hasFeedback ? 1 : 0)),
  );
  expect(stores.map((store) => store.getSubscriptionCount())).toEqual([1, 1]);
  const recovered = getProbe(harnesses[initiator].getRoot());
  const surviving = getProbe(harnesses[receiver].getRoot());
  if (!recovered || !surviving) throw new Error("Cascade did not finish");
  expect(getFiberById(originalIdentifiers[initiator])).toBeNull();
  const recoveredIdentifier = getFiberId(recovered);
  expect(recoveredIdentifier).not.toBe(originalIdentifiers[initiator]);
  expect(getFiberById(recoveredIdentifier) === recovered).toBe(true);
  expect(getFiberId(surviving)).toBe(originalIdentifiers[receiver]);
  expect(getFiberById(originalIdentifiers[receiver]) === surviving).toBe(true);
  expect((hasFeedback ? surviving : surviving.alternate) === originals[receiver]).toBe(true);
  expect(harnesses.map((harness) => harness.container.textContent)).toEqual(
    [0, 1].map((owner) => `${owner}:${owner === initiator ? 2 : hasFeedback ? 3 : 1}`),
  );
  for (const owner of [receiver, initiator]) {
    const value = owner === initiator ? 2 : hasFeedback ? 3 : 1;
    await harnesses[owner].render(null);
    expect(trace.splice(0)).toEqual([
      `delete:${owner}:${value}:true`,
      "report:delete",
      `layout-off:${owner}:${value}:true`,
      `commit:${owner}:empty:false`,
      `phase:${owner}:root:unmount`,
      `passive-off:${owner}:${value}:true`,
      `post:${owner}:empty`,
      "report:post",
      `later-post:${owner}:true`,
    ]);
    if (owner === receiver) {
      const controlRoot = harnesses[initiator].getRoot();
      expect(_fiberRoots.has(controlRoot)).toBe(true);
      expect(getProbe(controlRoot) === recovered).toBe(true);
      expect(getFiberById(recoveredIdentifier) === recovered).toBe(true);
      expect(harnesses[initiator].container.textContent).toBe(`${initiator}:2`);
      expect(stores.map((store) => store.getSubscriptionCount())).toEqual(
        [0, 1].map((innerOwner) => (innerOwner === initiator ? 1 : 0)),
      );
    }
  }
  for (const identifier of identifiers.values()) expect(getFiberById(identifier)).toBeNull();
  expect(stores.map((store) => store.getSubscriptionCount())).toEqual([0, 0]);
  expect(
    failures.map((error) =>
      error === postFailure ? "post" : error === deletionFailure ? "delete" : "unknown",
    ),
  ).toEqual([
    "post",
    "post",
    "delete",
    "post",
    "post",
    "post",
    ...(hasFeedback ? ["post"] : []),
    "delete",
    "post",
    "delete",
    "post",
  ]);
  return transcript;
};

it.each(
  [0, 1].flatMap((initiator) => [
    { initiator, isPassiveStore: false, hasFeedback: false },
    { initiator, isPassiveStore: true, hasFeedback: false },
    { initiator, isPassiveStore: true, hasFeedback: true },
  ]),
)(
  "replays cleanup-driven commits and post-commit ordering, initiator $initiator, passive store $isPassiveStore, feedback $hasFeedback",
  async ({ initiator, isPassiveStore, hasFeedback }) => {
    expect(await runCleanupCascade(initiator, isPassiveStore, hasFeedback)).toEqual(
      await runCleanupCascade(initiator, isPassiveStore, hasFeedback),
    );
  },
);
