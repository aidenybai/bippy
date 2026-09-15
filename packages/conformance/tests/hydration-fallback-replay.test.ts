import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

interface HydrationProbeProps {
  name: string;
  revision: number;
}

interface HydrationGateProps {
  owner: number;
  revision: number;
}

interface HydrationIdentity {
  fiber: Fiber;
  identifier: number;
  host: Node;
}

const runHydrationFallback = async (
  firstOwner: number,
  isPendingDeleted: boolean,
): Promise<string[]> => {
  const otherOwner = 1 - firstOwner;
  const control = createRenderHarness();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const owners = [0, 1];
  const gates = owners.map(() => {
    const { promise, resolve } = Promise.withResolvers<void>();
    return { promise, resolve, isReady: false };
  });
  const serverFailures = owners.map((owner) => new Error(`server boundary ${owner}`));
  const serverThrows = new Set<Error>();
  const clientSuspensions = new Set<number>();
  const clientRenders = new Set<string>();
  const identities = new Map<string, HydrationIdentity>();
  const recoveries: unknown[] = [];
  const reports: unknown[] = [];
  const deletionFailure = new Error("hydration deletion observer failed");
  const transcript: string[] = [];
  const trace: string[] = [];
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
  const getIdentity = (name: string): HydrationIdentity => {
    const identity = identities.get(name);
    if (!identity) throw new Error(`Missing identity ${name}`);
    return identity;
  };
  const Probe = ({ name, revision }: HydrationProbeProps) => {
    if (!isServerRendering) clientRenders.add(name);
    const rendering = getRenderingFiber();
    React.useLayoutEffect(() => {
      if (!rendering || !(rendering.child?.stateNode instanceof Node))
        throw new Error(`Missing rendering host ${name}`);
      const identifier = getFiberId(rendering);
      identities.set(name, { fiber: rendering, identifier, host: rendering.child.stateNode });
      record(`layout-on:${name}:${getLatestFiber(rendering) === rendering}`);
      return () => {
        record(`layout-off:${name}:${getFiberById(identifier) === null}`);
      };
    }, [name]);
    React.useEffect(() => {
      record(`passive-on:${name}`);
      return () => {
        record(`passive-off:${name}:${getFiberById(getIdentity(name).identifier) === null}`);
      };
    }, [name]);
    return jsx("span", { "data-probe": name, children: `${name}:${revision}` });
  };
  const Gate = ({ owner, revision }: HydrationGateProps) => {
    if (isServerRendering) {
      serverThrows.add(serverFailures[owner]);
      throw serverFailures[owner];
    }
    if (!gates[owner].isReady) {
      clientSuspensions.add(owner);
      throw gates[owner].promise;
    }
    return jsx(Probe, { name: `${owner}-primary`, revision });
  };
  const getTree = (visibleOwners = owners, revision = 0) =>
    jsxs("main", {
      children: [
        jsx(Probe, { name: "shell", revision }, "shell"),
        ...visibleOwners.map((owner) =>
          jsx(
            React.Suspense,
            {
              fallback: jsx(Probe, { name: `${owner}-fallback`, revision }),
              children: jsx(Gate, { owner, revision }),
            },
            String(owner),
          ),
        ),
      ],
    });
  const getRoot = (): FiberRoot => {
    if (!committedRoot) throw new Error("Missing hydration commit");
    return committedRoot;
  };
  const getCurrentProbe = (name: string): Fiber => {
    const fiber = getFiberPreorder(getRoot().current).find(
      (candidate) => candidate.type === Probe && candidate.memoizedProps.name === name,
    );
    if (!fiber) throw new Error(`Missing current probe ${name}`);
    return fiber;
  };
  const checkProbe = (name: string, revision: number): void => {
    const current = getCurrentProbe(name);
    const original = getIdentity(name);
    expect(getFiberId(current)).toBe(original.identifier);
    expect(getFiberById(original.identifier) === current).toBe(true);
    expect(getLatestFiber(original.fiber) === current).toBe(true);
    expect(current.child?.stateNode === original.host).toBe(true);
    expect(original.host.textContent).toBe(`${name}:${revision}`);
  };
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
      .map((owner) => `${owner}:${readyOwners.includes(owner) ? "primary" : "fallback"}`)
      .join(",");
  const getDeletion = (name: string): string[] => [
    `delete:${name}:true`,
    "report:delete",
    `layout-off:${name}:true`,
  ];
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((_message: unknown, error: unknown) => {
      reports.push(error);
      record(`report:${error === deletionFailure ? "delete" : "unknown"}`);
      throw new Error("hydration reporter failed");
    });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (!("containerInfo" in root) || root.containerInfo !== container) return;
      committedRoot = root;
      for (const fiber of getFiberPreorder(root.current)) {
        if (fiber.tag !== getReactWorkTags().DehydratedSuspenseComponent) continue;
        if (!(fiber.stateNode instanceof Comment)) throw new Error("Missing dehydrated marker");
        const name = `dehydrated:${fiber.return?.key}`;
        if (!identities.has(name))
          identities.set(name, { fiber, identifier: getFiberId(fiber), host: fiber.stateNode });
      }
      record(`commit:${getStates(root)}:${_fiberRoots.has(root)}`);
      traverseRenderedFibers(isPendingDeleted ? root.current : root, (fiber, phase) => {
        if (fiber.type === Probe) record(`phase:${fiber.memoizedProps.name}:${phase}`);
        else if (fiber.tag === getReactWorkTags().HostRoot && phase === "unmount")
          record("phase:root:unmount");
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      const name =
        fiber.type === Probe
          ? String(fiber.memoizedProps.name)
          : [...identities].find(([, identity]) => identity.fiber === fiber)?.[0];
      if (!name) return;
      record(`delete:${name}:${getFiberById(getIdentity(name).identifier) === fiber}`);
      throw deletionFailure;
    },
  });
  try {
    container.innerHTML = renderToString(getTree());
    isServerRendering = false;
    const serverMain = container.firstElementChild;
    const serverShell = container.querySelector('[data-probe="shell"]');
    const serverFallbacks = [...container.querySelectorAll('[data-probe$="-fallback"]')];
    const serverMessages = [...container.querySelectorAll("template")].map((template) =>
      template.getAttribute("data-msg"),
    );
    expect(serverMessages).toHaveLength(2);
    for (const owner of owners) {
      expect(serverThrows.has(serverFailures[owner])).toBe(true);
      expect(serverMessages[owner]).toContain(serverFailures[owner].message);
    }
    expect(trace.splice(0)).toEqual([]);
    await control.render(jsx(Probe, { name: "control", revision: 0 }));
    expect(trace.splice(0)).toEqual(["layout-on:control:true", "passive-on:control"]);
    clientRenders.clear();
    await React.act(async () => {
      hydrationRoot = hydrateRoot(container, getTree(), {
        onRecoverableError: (error) => {
          recoveries.push(error);
          record(
            `recover:${serverMessages.findIndex((message) => error instanceof Error && error.message === message)}`,
          );
        },
      });
    });
    const root = hydrationRoot;
    if (!root) throw new Error("Missing hydration root");
    expect(trace.splice(0)).toEqual([
      "layout-on:shell:true",
      "commit:0:dehydrated,1:dehydrated:true",
      "phase:shell:mount",
      "passive-on:shell",
      "delete:dehydrated:0:true",
      "report:delete",
      "delete:dehydrated:1:true",
      "report:delete",
      "layout-on:0-fallback:true",
      "layout-on:1-fallback:true",
      "commit:0:fallback,1:fallback:true",
      "phase:0-fallback:mount",
      "phase:1-fallback:mount",
      "recover:0",
      "recover:1",
      "passive-on:0-fallback",
      "passive-on:1-fallback",
      "commit:0:fallback,1:fallback:true",
    ]);
    expect(clientRenders).toEqual(new Set(["shell", "0-fallback", "1-fallback"]));
    expect(recoveries.map((error) => (error instanceof Error ? error.message : null))).toEqual(
      serverMessages,
    );
    for (const owner of owners) {
      expect(clientSuspensions.has(owner)).toBe(true);
      expect(recoveries[owner] === serverFailures[owner]).toBe(false);
      const dehydrated = getIdentity(`dehydrated:${owner}`);
      expect(getFiberById(dehydrated.identifier)).toBeNull();
      expect(dehydrated.host.isConnected).toBe(false);
      expect(serverFallbacks[owner].isConnected).toBe(false);
      expect(getIdentity(`${owner}-fallback`).host === serverFallbacks[owner]).toBe(false);
    }
    expect(container.firstElementChild === serverMain).toBe(true);
    expect(getIdentity("shell").host === serverShell).toBe(true);
    checkProbe("shell", 0);
    const resolveOwner = async (owner: number): Promise<void> => {
      await React.act(async () => {
        gates[owner].isReady = true;
        gates[owner].resolve();
        await gates[owner].promise;
      });
    };
    clientRenders.clear();
    await resolveOwner(firstOwner);
    expect(trace.splice(0)).toEqual([
      ...getDeletion(`${firstOwner}-fallback`),
      `layout-on:${firstOwner}-primary:true`,
      `commit:${getExpectedStates(owners, [firstOwner])}:true`,
      `phase:${firstOwner}-primary:mount`,
      `passive-off:${firstOwner}-fallback:true`,
      `passive-on:${firstOwner}-primary`,
    ]);
    expect(clientRenders).toEqual(new Set([`${firstOwner}-primary`]));
    checkProbe("shell", 0);
    checkProbe(`${firstOwner}-primary`, 0);
    checkProbe(`${otherOwner}-fallback`, 0);
    const liveOwners = isPendingDeleted ? [firstOwner] : owners;
    clientRenders.clear();
    if (isPendingDeleted) {
      await React.act(async () => root.render(getTree(liveOwners)));
      expect(trace.splice(0)).toEqual([
        ...getDeletion(`${otherOwner}-fallback`),
        `commit:${getExpectedStates(liveOwners, liveOwners)}:true`,
        "phase:shell:update",
        `phase:${firstOwner}-primary:update`,
        `passive-off:${otherOwner}-fallback:true`,
      ]);
      expect(clientRenders).toEqual(new Set(["shell", `${firstOwner}-primary`]));
      const beforeSettlement = getRoot().current;
      clientRenders.clear();
      await resolveOwner(otherOwner);
      expect(clientRenders.size).toBe(0);
      expect(trace.splice(0)).toEqual([]);
      expect(getRoot().current === beforeSettlement).toBe(true);
      expect(identities.has(`${otherOwner}-primary`)).toBe(false);
    } else {
      await resolveOwner(otherOwner);
      expect(trace.splice(0)).toEqual([
        ...getDeletion(`${otherOwner}-fallback`),
        `layout-on:${otherOwner}-primary:true`,
        `commit:${getExpectedStates(owners, owners)}:true`,
        `phase:${otherOwner}-primary:mount`,
        `passive-off:${otherOwner}-fallback:true`,
        `passive-on:${otherOwner}-primary`,
      ]);
      expect(clientRenders).toEqual(new Set([`${otherOwner}-primary`]));
    }
    checkProbe("shell", 0);
    const liveNames = ["shell", ...liveOwners.map((owner) => `${owner}-primary`)];
    const beforeUpdates = liveNames.map(getCurrentProbe);
    for (const revision of [1, 2]) {
      clientRenders.clear();
      await React.act(async () => root.render(getTree(liveOwners, revision)));
      expect(trace.splice(0)).toEqual([
        `commit:${getExpectedStates(liveOwners, liveOwners)}:true`,
        ...liveNames.map((name) => `phase:${name}:update`),
      ]);
      expect(clientRenders).toEqual(new Set(liveNames));
      for (const name of liveNames) checkProbe(name, revision);
      expect(container.firstElementChild === serverMain).toBe(true);
    }
    expect(liveNames.every((name, index) => getCurrentProbe(name) === beforeUpdates[index])).toBe(
      true,
    );
    await React.act(async () => root.unmount());
    hydrationRoot = undefined;
    expect(trace.splice(0)).toEqual([
      ...liveNames.flatMap(getDeletion),
      "commit:empty:false",
      "phase:root:unmount",
      ...liveNames.map((name) => `passive-off:${name}:true`),
    ]);
    expect(_fiberRoots.has(getRoot())).toBe(false);
    expect(_fiberRoots.has(control.getRoot())).toBe(true);
    expect(getFiberById(getIdentity("control").identifier) === getIdentity("control").fiber).toBe(
      true,
    );
    expect(getIdentity("control").host.isConnected).toBe(true);
    expect(container.childNodes).toHaveLength(0);
    await control.render(null);
    expect(trace.splice(0)).toEqual([...getDeletion("control"), "passive-off:control:true"]);
    for (const identity of identities.values())
      expect(getFiberById(identity.identifier)).toBeNull();
    expect(recoveries).toHaveLength(2);
    expect(reports).toHaveLength(5 + liveNames.length);
    expect(reports.every((error) => error === deletionFailure)).toBe(true);
    return transcript;
  } finally {
    const root = hydrationRoot;
    if (root) await React.act(async () => root.unmount());
    container.remove();
  }
};

it.each(
  [0, 1].flatMap((firstOwner) =>
    [false, true].map((isPendingDeleted) => ({ firstOwner, isPendingDeleted })),
  ),
)(
  "replays local hydration fallback recovery, first $firstOwner, delete pending $isPendingDeleted",
  async ({ firstOwner, isPendingDeleted }) => {
    expect(await runHydrationFallback(firstOwner, isPendingDeleted)).toEqual(
      await runHydrationFallback(firstOwner, isPendingDeleted),
    );
  },
);
