import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

interface SelectiveOwnerProps {
  owner: number;
}
interface SelectiveIdentity {
  fiber: Fiber;
  identifier: number;
  host: HTMLButtonElement;
}

const runSelectiveHydration = async (
  latestOwner: number,
  isLatestDeleted: boolean,
): Promise<string[]> => {
  const earlierOwner = 1 - latestOwner;
  const owners = [0, 1];
  const control = createRenderHarness();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const gates = owners.map(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    return { promise, resolve, isReady: false };
  });
  const replayed = Promise.withResolvers<void>();
  const originals = owners.map(() => new FocusEvent("focusin", { bubbles: true }));
  const captures: Event[] = [];
  const nativeReplays = new Map<number, Event>();
  const clientRenders = new Set<number>();
  const suspended = new Set<number>();
  const identities = new Map<number, SelectiveIdentity>();
  const boundaryIdentifiers = new Map<number, number>();
  const reports: unknown[] = [];
  const recoveries: unknown[] = [];
  const failure = new Error("selective hydration observer failed");
  const trace: string[] = [];
  const transcript: string[] = [];
  const listeners: Array<() => void> = [];
  let isServerRendering = true;
  let committedRoot: FiberRoot | undefined;
  let hydrationRoot: Root | undefined;
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getRoot = (): FiberRoot => {
    if (!committedRoot) throw new Error("Missing hydration root");
    return committedRoot;
  };
  const getIdentity = (owner: number): SelectiveIdentity => {
    const identity = identities.get(owner);
    if (!identity) throw new Error(`Missing probe ${owner}`);
    return identity;
  };
  const getBoundaryIdentifier = (owner: number): number => {
    const identifier = boundaryIdentifiers.get(owner);
    if (identifier === undefined) throw new Error(`Missing boundary ${owner}`);
    return identifier;
  };
  const getBoundary = (owner: number): Fiber => {
    const boundary = getFiberPreorder(getRoot().current).find(
      (fiber) => fiber.tag === getReactWorkTags().SuspenseComponent && fiber.key === String(owner),
    );
    if (!boundary) throw new Error(`Missing current boundary ${owner}`);
    return boundary;
  };
  const getProbe = (owner: number): Fiber => {
    const root = owner === 2 ? control.getRoot() : getRoot();
    const probe = getFiberPreorder(root.current).find(
      (fiber) => fiber.type === Probe && fiber.memoizedProps.owner === owner,
    );
    if (!probe) throw new Error(`Missing current probe ${owner}`);
    return probe;
  };
  const getCurrentHostFiber = (host: Node, hasHook = true): Fiber | null => {
    const fiber = getFiber(host, hasHook ? globalThis : {});
    return fiber ? getLatestFiber(fiber) : null;
  };
  const Probe = ({ owner }: SelectiveOwnerProps) => {
    if (!isServerRendering) clientRenders.add(owner);
    const rendering = getRenderingFiber();
    const [count, setCount] = React.useState(0);
    React.useLayoutEffect(() => {
      if (!rendering || !(rendering.child?.stateNode instanceof HTMLButtonElement))
        throw new Error(`Missing host ${owner}`);
      const identifier = getFiberId(rendering);
      identities.set(owner, { fiber: rendering, identifier, host: rendering.child.stateNode });
      record(`layout-on:${owner}:${getLatestFiber(rendering) === rendering}`);
      return () => {
        record(`layout-off:${owner}:${getFiberById(identifier) === null}`);
      };
    }, [owner]);
    React.useEffect(() => {
      record(`passive-on:${owner}`);
      return () => {
        record(`passive-off:${owner}:${getFiberById(getIdentity(owner).identifier) === null}`);
      };
    }, [owner]);
    return jsx("button", {
      "data-owner": owner,
      children: `${owner}:${count}`,
      onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
        record(
          `focus:${owner}:${getCurrentHostFiber(event.currentTarget) === getProbe(owner).child}:${event.target === getIdentity(owner).host}:${event.nativeEvent === nativeReplays.get(owner)}`,
        );
        setCount((previous) => previous + 1);
      },
    });
  };
  const Gate = ({ owner }: SelectiveOwnerProps) => {
    if (!isServerRendering && !gates[owner].isReady) {
      suspended.add(owner);
      throw gates[owner].promise;
    }
    return jsx(Probe, { owner });
  };
  const getTree = (visibleOwners = owners) =>
    jsxs("main", {
      children: visibleOwners.map((owner) =>
        jsx(
          React.Suspense,
          {
            fallback: jsx("i", { children: "unexpected fallback" }),
            children: jsx(Gate, { owner }),
          },
          String(owner),
        ),
      ),
    });
  const getStates = (root: FiberRoot): string =>
    getFiberPreorder(root.current)
      .filter((fiber) => fiber.tag === getReactWorkTags().SuspenseComponent)
      .map(
        (fiber) =>
          `${fiber.key}:${fiber.memoizedState?.dehydrated ? "dehydrated" : fiber.memoizedState === null ? "primary" : "fallback"}`,
      )
      .join(",") || "empty";
  const getExpectedStates = (visibleOwners: number[], readyOwners: number[]): string =>
    visibleOwners
      .map((owner) => `${owner}:${readyOwners.includes(owner) ? "primary" : "dehydrated"}`)
      .join(",");
  const getProbeDeletion = (owner: number): string[] => [
    `delete-probe:${owner}:true`,
    "report",
    `layout-off:${owner}:true`,
  ];
  const getBoundaryDeletion = (owner: number): string[] => [
    `delete-boundary:${owner}:true`,
    "report",
  ];
  const checkLive = (owner: number, count: number): void => {
    const identity = getIdentity(owner);
    const current = getProbe(owner);
    expect(getFiberId(current)).toBe(identity.identifier);
    expect(getFiberById(identity.identifier) === current).toBe(true);
    expect(getLatestFiber(identity.fiber) === current).toBe(true);
    expect(current.child?.stateNode === identity.host).toBe(true);
    expect(getCurrentHostFiber(identity.host) === current.child).toBe(true);
    expect(getCurrentHostFiber(identity.host, false) === current.child).toBe(true);
    expect(identity.host.textContent).toBe(`${owner}:${count}`);
    if (owner !== 2)
      expect(getFiberById(getBoundaryIdentifier(owner)) === getBoundary(owner)).toBe(true);
  };
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((_message: unknown, error: unknown) => {
      reports.push(error);
      record("report");
      throw new Error("selective hydration reporter failed");
    });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (!("containerInfo" in root) || root.containerInfo !== container) return;
      committedRoot = root;
      for (const fiber of getFiberPreorder(root.current)) {
        if (fiber.tag === getReactWorkTags().SuspenseComponent)
          boundaryIdentifiers.set(Number(fiber.key), getFiberId(fiber));
      }
      record(`commit:${getStates(root)}:${_fiberRoots.has(root)}`);
      traverseRenderedFibers(isLatestDeleted ? root.current : root, (fiber, phase) => {
        if (fiber.type === Probe) record(`phase:${fiber.memoizedProps.owner}:${phase}`);
        else if (fiber.tag === getReactWorkTags().HostRoot && phase === "unmount")
          record("phase:root:unmount");
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type === Probe) {
        const owner = Number(fiber.memoizedProps.owner);
        record(`delete-probe:${owner}:${getFiberById(getIdentity(owner).identifier) === fiber}`);
      } else if (
        fiber.tag === getReactWorkTags().SuspenseComponent &&
        boundaryIdentifiers.has(Number(fiber.key))
      ) {
        record(
          `delete-boundary:${fiber.key}:${getFiberById(getBoundaryIdentifier(Number(fiber.key))) === fiber}`,
        );
      } else if (fiber.tag === getReactWorkTags().DehydratedSuspenseComponent) {
        record(`delete-marker:${fiber.return?.key}`);
      } else return;
      throw failure;
    },
  });
  try {
    container.innerHTML = renderToString(getTree());
    isServerRendering = false;
    const serverMain = container.firstElementChild;
    const buttons = owners.map((owner) => {
      const button = container.querySelector(`button[data-owner="${owner}"]`);
      if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing server button ${owner}`);
      const onNativeFocus = (event: Event): void => {
        nativeReplays.set(owner, event);
        record(`native:${owner}:${event !== originals[owner]}:${button.isConnected}`);
        if (owner === latestOwner) replayed.resolve();
      };
      button.addEventListener("focusin", onNativeFocus);
      listeners.push(() => button.removeEventListener("focusin", onNativeFocus));
      return button;
    });
    const onCapture = (event: Event): void => {
      captures.push(event);
    };
    container.addEventListener("focusin", onCapture, true);
    listeners.push(() => container.removeEventListener("focusin", onCapture, true));
    expect(container.querySelector("template")).toBeNull();
    await control.render(jsx(Probe, { owner: 2 }));
    expect(trace.splice(0)).toEqual(["layout-on:2:true", "passive-on:2"]);
    clientRenders.clear();
    await React.act(async () => {
      hydrationRoot = hydrateRoot(container, getTree(), {
        onRecoverableError: (error) => {
          recoveries.push(error);
          record("recover");
        },
      });
    });
    const root = hydrationRoot;
    if (!root) throw new Error("Missing public root");
    expect(trace.splice(0)).toEqual([
      "commit:0:dehydrated,1:dehydrated:true",
      "commit:0:dehydrated,1:dehydrated:true",
    ]);
    expect(suspended).toEqual(new Set(owners));
    expect(clientRenders.size).toBe(0);
    const originalBoundaryIds = owners.map(getBoundaryIdentifier);
    for (const owner of owners) {
      expect(buttons[owner].isConnected).toBe(true);
      expect(getCurrentHostFiber(buttons[owner])).toBeNull();
      expect(getFiberById(getBoundaryIdentifier(owner)) === getBoundary(owner)).toBe(true);
      expect(getCurrentHostFiber(buttons[owner], false)).toBeNull();
    }
    await React.act(async () => {
      for (const owner of [earlierOwner, latestOwner])
        buttons[owner].dispatchEvent(originals[owner]);
    });
    expect(
      captures.map((event, index) => event === originals[[earlierOwner, latestOwner][index]]),
    ).toEqual([true, true]);
    expect(nativeReplays.size).toBe(0);
    expect(trace.splice(0)).toEqual(["commit:0:dehydrated,1:dehydrated:true"]);
    const resolveOwner = async (owner: number): Promise<void> => {
      await React.act(async () => {
        gates[owner].isReady = true;
        gates[owner].resolve();
        await gates[owner].promise;
      });
    };
    await resolveOwner(earlierOwner);
    expect(trace.splice(0)).toEqual([
      `layout-on:${earlierOwner}:true`,
      `commit:${getExpectedStates(owners, [earlierOwner])}:true`,
      `phase:${earlierOwner}:mount`,
      `passive-on:${earlierOwner}`,
    ]);
    expect(clientRenders).toEqual(new Set([earlierOwner]));
    expect(nativeReplays.size).toBe(0);
    expect(getIdentity(earlierOwner).host === buttons[earlierOwner]).toBe(true);
    checkLive(earlierOwner, 0);
    expect(getCurrentHostFiber(buttons[latestOwner])).toBeNull();
    expect(getFiberById(getBoundaryIdentifier(latestOwner)) === getBoundary(latestOwner)).toBe(
      true,
    );
    clientRenders.clear();
    if (isLatestDeleted) {
      await React.act(async () => root.render(getTree([earlierOwner])));
      await React.act(async () => {
        await replayed.promise;
      });
      expect(trace.splice(0)).toEqual([
        ...getBoundaryDeletion(latestOwner),
        `delete-marker:${latestOwner}`,
        "report",
        `commit:${earlierOwner}:primary:true`,
        `phase:${earlierOwner}:update`,
        `native:${latestOwner}:true:false`,
      ]);
      expect(clientRenders).toEqual(new Set([earlierOwner]));
      expect(getFiberById(originalBoundaryIds[latestOwner])).toBeNull();
      expect(identities.has(latestOwner)).toBe(false);
      expect(getFiber(buttons[latestOwner])).toBeNull();
      clientRenders.clear();
      const beforeSettlement = getRoot().current;
      await resolveOwner(latestOwner);
      expect(trace.splice(0)).toEqual([]);
      expect(clientRenders.size).toBe(0);
      expect(getRoot().current === beforeSettlement).toBe(true);
      await React.act(async () => root.render(getTree()));
      expect(trace.splice(0)).toEqual([
        `layout-on:${latestOwner}:true`,
        "commit:0:primary,1:primary:true",
        ...owners.map((owner) => `phase:${owner}:${owner === latestOwner ? "mount" : "update"}`),
        `passive-on:${latestOwner}`,
      ]);
      expect(getIdentity(latestOwner).host === buttons[latestOwner]).toBe(false);
      expect(getBoundaryIdentifier(latestOwner)).not.toBe(originalBoundaryIds[latestOwner]);
      expect(getFiber(buttons[latestOwner])).toBeNull();
    } else {
      await resolveOwner(latestOwner);
      await React.act(async () => {
        await replayed.promise;
      });
      expect(trace.splice(0)).toEqual([
        `layout-on:${latestOwner}:true`,
        "commit:0:primary,1:primary:true",
        `phase:${latestOwner}:mount`,
        `passive-on:${latestOwner}`,
        `native:${latestOwner}:true:true`,
        `focus:${latestOwner}:true:true:true`,
        "commit:0:primary,1:primary:true",
        `phase:${latestOwner}:update`,
      ]);
      expect(clientRenders).toEqual(new Set([latestOwner]));
      expect(getIdentity(latestOwner).host === buttons[latestOwner]).toBe(true);
      expect(getBoundaryIdentifier(latestOwner)).toBe(originalBoundaryIds[latestOwner]);
    }
    expect([...nativeReplays.keys()]).toEqual([latestOwner]);
    expect(captures).toHaveLength(isLatestDeleted ? 2 : 3);
    if (!isLatestDeleted) expect(captures[2] === nativeReplays.get(latestOwner)).toBe(true);
    checkLive(earlierOwner, 0);
    checkLive(latestOwner, isLatestDeleted ? 0 : 1);
    checkLive(2, 0);
    expect(getBoundaryIdentifier(earlierOwner)).toBe(originalBoundaryIds[earlierOwner]);
    expect(container.firstElementChild === serverMain).toBe(true);
    await React.act(async () => root.unmount());
    hydrationRoot = undefined;
    expect(trace.splice(0)).toEqual([
      ...owners.flatMap((owner) => [...getBoundaryDeletion(owner), ...getProbeDeletion(owner)]),
      "commit:empty:false",
      "phase:root:unmount",
      ...owners.map((owner) => `passive-off:${owner}:true`),
    ]);
    for (const owner of owners) {
      expect(getFiber(buttons[owner])).toBeNull();
      expect(getFiber(getIdentity(owner).host)).toBeNull();
      expect(getFiberById(getBoundaryIdentifier(owner))).toBeNull();
    }
    expect(_fiberRoots.has(getRoot())).toBe(false);
    expect(_fiberRoots.has(control.getRoot())).toBe(true);
    checkLive(2, 0);
    await control.render(null);
    expect(trace.splice(0)).toEqual([...getProbeDeletion(2), "passive-off:2:true"]);
    for (const identity of identities.values())
      expect(getFiberById(identity.identifier)).toBeNull();
    expect(reports).toHaveLength(isLatestDeleted ? 7 : 5);
    expect(reports.every((error) => error === failure)).toBe(true);
    expect(recoveries).toEqual([]);
    return transcript;
  } finally {
    const root = hydrationRoot;
    if (root) await React.act(async () => root.unmount());
    for (const removeListener of listeners) removeListener();
    container.remove();
  }
};

it.each(
  [0, 1].flatMap((latestOwner) =>
    [false, true].map((isLatestDeleted) => ({ latestOwner, isLatestDeleted })),
  ),
)(
  "replays coalesced focus during selective hydration, latest $latestOwner, delete latest $isLatestDeleted",
  async ({ latestOwner, isLatestDeleted }) => {
    expect(await runSelectiveHydration(latestOwner, isLatestDeleted)).toEqual(
      await runSelectiveHydration(latestOwner, isLatestDeleted),
    );
  },
);
