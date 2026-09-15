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

interface ActivityHydrationProps {
  owner: number;
  role: string;
}
interface ActivityHydrationOwner {
  owner: number;
}
interface ActivityHydrationIdentity {
  fiber: Fiber;
  identifier: number;
  hostIdentifier: number;
  host: HTMLSpanElement;
  token: object;
}
interface ActivityHydrationAttempt {
  owner: number;
  isCurrent: boolean;
  isSpeculative: boolean;
  isDehydrated: boolean;
}
interface ActivityHydrationOptions {
  owner: number;
  deletesPending: boolean;
}

const runActivityHydration = async ({
  owner,
  deletesPending,
}: ActivityHydrationOptions): Promise<string[]> => {
  const sibling = 1 - owner;
  const owners = [0, 1];
  const control = createRenderHarness();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const gates = owners.map(() => ({ ...Promise.withResolvers<void>(), isReady: false }));
  const trace: string[] = [];
  const transcript: string[] = [];
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const attempts: ActivityHydrationAttempt[] = [];
  const rendered = new Set<string>();
  const updateCounts = new Map<string, (count: number) => void>();
  const identities = new Map<string, ActivityHydrationIdentity>();
  const boundaryIds = new Map<string, number>();
  const recoveries: unknown[] = [];
  const failure = new Error("Activity hydration observer failed");
  const reporterFailure = new Error("Activity hydration reporter failed");
  let isServer = true;
  let committedRoot: FiberRoot | undefined;
  let hydrationRoot: Root | undefined;
  const renderer = [...getRDTHook().renderers.values()].find(
    (candidate) => candidate.rendererPackageName === "react-dom",
  );
  if (!renderer?.getCurrentFiber) throw new Error("Missing Activity rendering oracle");
  const getRenderingFiber = renderer.getCurrentFiber;
  const getRoot = (): FiberRoot => {
    if (!committedRoot) throw new Error("Missing Activity hydration root");
    return committedRoot;
  };
  const getIdentity = (name: string): ActivityHydrationIdentity => {
    const identity = identities.get(name);
    if (!identity) throw new Error(`Missing probe ${name}`);
    return identity;
  };
  const getBoundaryName = (fiber: Fiber): string | null =>
    fiber.elementType === React.Activity
      ? `activity:${fiber.key}`
      : fiber.tag === getReactWorkTags().SuspenseComponent
        ? `suspense:${fiber.key}`
        : null;
  const getBoundary = (name: string): Fiber => {
    const fiber = getFiberPreorder(getRoot().current).find(
      (candidate) => getBoundaryName(candidate) === name,
    );
    if (!fiber) throw new Error(`Missing boundary ${name}`);
    return fiber;
  };
  const Probe = ({ owner: checkedOwner, role }: ActivityHydrationProps) => {
    const name = `${checkedOwner}:${role}`;
    const rendering = getRenderingFiber();
    const [token] = React.useState(() => ({}));
    const [count, setCount] = React.useState(0);
    if (!isServer) {
      rendered.add(name);
      updateCounts.set(name, setCount);
    }
    React.useLayoutEffect(() => {
      const hostFiber = rendering?.child;
      if (!rendering || !hostFiber || !(hostFiber.stateNode instanceof HTMLSpanElement))
        throw new Error("Missing hydrated host");
      const identity = {
        fiber: rendering,
        identifier: getFiberId(rendering),
        hostIdentifier: getFiberId(hostFiber),
        host: hostFiber.stateNode,
        token,
      };
      identities.set(name, identity);
      record(`layout-on:${name}:${getLatestFiber(rendering) === rendering}`);
      return () => record(`layout-off:${name}:${getFiberById(identity.identifier) === null}`);
    }, [name]);
    React.useEffect(() => {
      record(`passive-on:${name}`);
      return () =>
        record(`passive-off:${name}:${getFiberById(getIdentity(name).identifier) === null}`);
    }, [name]);
    return jsx("span", { "data-probe": name, children: `${name}:${count}` });
  };
  const Gate = ({ owner: checkedOwner }: ActivityHydrationOwner) => {
    if (!isServer && !gates[checkedOwner].isReady) {
      let activity = getRenderingFiber();
      while (activity && activity.elementType !== React.Activity) activity = activity.return;
      if (!activity) throw new Error("Missing rendering Activity");
      const current = getBoundary(`activity:${checkedOwner}`);
      attempts.push({
        owner: checkedOwner,
        isCurrent: getLatestFiber(activity) === current,
        isSpeculative: activity !== current,
        isDehydrated: current.memoizedState?.dehydrated instanceof Comment,
      });
      throw gates[checkedOwner].promise;
    }
    return jsx(Probe, { owner: checkedOwner, role: "primary" });
  };
  const Frame = ({ owner: checkedOwner }: ActivityHydrationOwner) =>
    jsxs("section", {
      "data-section": checkedOwner,
      children: [
        jsx(!isServer && checkedOwner === owner ? "article" : "div", {
          children: `heading:${checkedOwner}`,
        }),
        jsx(Gate, { owner: checkedOwner }),
      ],
    });
  const sections = owners.map((checkedOwner) =>
    jsx(
      React.Suspense,
      {
        fallback: jsx(Probe, { owner: checkedOwner, role: "fallback" }),
        children: jsx(
          React.Activity,
          { mode: "visible", children: jsx(Frame, { owner: checkedOwner }) },
          String(checkedOwner),
        ),
      },
      String(checkedOwner),
    ),
  );
  const shell = jsx(Probe, { owner: 3, role: "shell" });
  const getTree = (visibleOwners = owners) =>
    jsxs("main", {
      children: [shell, ...visibleOwners.map((checkedOwner) => sections[checkedOwner])],
    });
  const getStates = (root: FiberRoot): string =>
    getFiberPreorder(root.current)
      .flatMap((fiber) => {
        const name = getBoundaryName(fiber);
        if (!name) return [];
        const state = fiber.memoizedState?.dehydrated
          ? "dehydrated"
          : fiber.memoizedState !== null
            ? "fallback"
            : "primary";
        return [`${name}:${state}`];
      })
      .join("|");
  const expectedStates = (
    visibleOwners: number[],
    hydrated: number[],
    hasFallback: boolean,
    hasActivities = true,
  ): string =>
    visibleOwners
      .flatMap((checkedOwner) => [
        `suspense:${checkedOwner}:${!hasActivities ? "dehydrated" : hasFallback && checkedOwner === owner ? "fallback" : "primary"}`,
        ...(hasActivities
          ? [
              `activity:${checkedOwner}:${hydrated.includes(checkedOwner) ? "primary" : "dehydrated"}`,
            ]
          : []),
      ])
      .join("|");
  const getCommit = (
    visibleOwners: number[],
    hydrated: number[],
    hasFallback: boolean,
    hasActivities = true,
  ): string => `commit:${expectedStates(visibleOwners, hydrated, hasFallback, hasActivities)}:true`;
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === failure}`);
      throw reporterFailure;
    });
  using _observer = instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      if (!("containerInfo" in root)) return;
      if (root.containerInfo === control.container) {
        record(`control:${control.container.textContent}`);
        return;
      }
      if (root.containerInfo !== container) return;
      committedRoot = root;
      for (const fiber of getFiberPreorder(root.current)) {
        const name = getBoundaryName(fiber);
        if (name) {
          const previousId = boundaryIds.get(name);
          record(
            `boundary:${name}:${previousId === undefined || getFiberById(previousId) === fiber}`,
          );
          boundaryIds.set(name, getFiberId(fiber));
        }
      }
      record(`commit:${getStates(root)}:${_fiberRoots.has(root)}`);
      traverseRenderedFibers(owner === 0 ? root.current : root, (fiber, phase) => {
        if (fiber.type === Probe)
          record(`phase:${fiber.memoizedProps.owner}:${fiber.memoizedProps.role}:${phase}`);
      });
    },
    onCommitFiberUnmount: (_rendererId, fiber) => {
      const name = getBoundaryName(fiber);
      if (name) record(`delete:${name}:${getFiberById(boundaryIds.get(name) ?? -1) === fiber}`);
      else if (fiber.type === Probe) {
        const probeName = `${fiber.memoizedProps.owner}:${fiber.memoizedProps.role}`;
        const lookup = getFiberById(getIdentity(probeName).identifier);
        const root = probeName === "2:control" ? control.getRoot() : getRoot();
        const current = getFiberPreorder(root.current).find(
          (candidate) =>
            candidate.type === Probe &&
            `${candidate.memoizedProps.owner}:${candidate.memoizedProps.role}` === probeName,
        );
        record(
          `delete:${probeName}:${lookup === fiber}:${fiber === current}:${getLatestFiber(fiber) === current}`,
        );
      } else if (fiber.tag === getReactWorkTags().DehydratedSuspenseComponent)
        record(`delete:marker:${getBoundaryName(fiber.return ?? fiber)}`);
      else return;
      throw failure;
    },
  });
  const getBoundaries = (visibleOwners = owners, hasActivities = true): string[] =>
    visibleOwners.flatMap((checkedOwner) => [
      `boundary:suspense:${checkedOwner}:true`,
      ...(hasActivities ? [`boundary:activity:${checkedOwner}:true`] : []),
    ]);
  const getReport = (): string => "report:Bippy instrumentation encountered an error::true";
  const getDelete = (name: string): string[] => [
    `delete:${name}:true:true:true`,
    getReport(),
    `layout-off:${name}:true`,
  ];
  const check = (name: string, host: HTMLSpanElement, count = 0): void => {
    const identity = getIdentity(name);
    const root = name === "2:control" ? control.getRoot() : getRoot();
    const fiber = getFiberPreorder(root.current).find(
      (candidate) =>
        candidate.type === Probe &&
        `${candidate.memoizedProps.owner}:${candidate.memoizedProps.role}` === name,
    );
    expect(fiber).toBeDefined();
    expect(identity.host).toBe(host);
    expect(getFiberById(identity.identifier)).toBe(fiber);
    expect(getLatestFiber(identity.fiber)).toBe(fiber);
    if (fiber?.alternate) expect(getLatestFiber(fiber.alternate)).toBe(fiber);
    expect(fiber?.memoizedState?.memoizedState).toBe(identity.token);
    expect(fiber?.memoizedState?.next?.memoizedState).toBe(count);
    expect(getFiberById(identity.hostIdentifier)?.stateNode).toBe(host);
    expect(getLatestFiber(getFiber(host) ?? identity.fiber)).toBe(fiber?.child);
    expect(host.isConnected).toBe(true);
    expect(host.textContent).toBe(`${name}:${count}`);
    expect(_fiberRoots.has(root)).toBe(true);
  };
  const settle = async (checkedOwner: number): Promise<void> => {
    await React.act(async () => {
      gates[checkedOwner].isReady = true;
      gates[checkedOwner].resolve();
      await gates[checkedOwner].promise;
    });
  };
  const retire = (identity: ActivityHydrationIdentity): void => {
    expect(getFiberById(identity.identifier)).toBeNull();
    expect(getFiberById(identity.hostIdentifier)).toBeNull();
    expect(identity.host.isConnected).toBe(false);
  };
  try {
    container.innerHTML = renderToString(getTree());
    isServer = false;
    const serverMain = container.firstElementChild;
    const serverHosts = owners.map((checkedOwner) => {
      const host = container.querySelector(`[data-probe="${checkedOwner}:primary"]`);
      if (!(host instanceof HTMLSpanElement)) throw new Error("Missing server Activity host");
      return host;
    });
    const serverShell = container.querySelector('[data-probe="3:shell"]');
    if (!(serverShell instanceof HTMLSpanElement)) throw new Error("Missing server shell");
    const serverSections = owners.map((checkedOwner) => {
      const section = container.querySelector(`[data-section="${checkedOwner}"]`);
      if (!(section instanceof HTMLElement)) throw new Error("Missing server section");
      return section;
    });
    expect(container.innerHTML).toContain("<!--&-->");
    await control.render(jsx(Probe, { owner: 2, role: "control" }));
    expect(trace.splice(0)).toEqual([
      "layout-on:2:control:true",
      "control:2:control:0",
      "passive-on:2:control",
    ]);
    const controlIdentity = getIdentity("2:control");
    rendered.clear();
    await React.act(async () => {
      hydrationRoot = hydrateRoot(container, getTree(), {
        onRecoverableError: (error) => {
          recoveries.push(error);
          record(`recover:${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`);
        },
      });
    });
    const root = hydrationRoot;
    if (!root) throw new Error("Missing public hydration root");
    expect(trace.splice(0)).toEqual([
      "layout-on:3:shell:true",
      ...getBoundaries(owners, false),
      getCommit(owners, [], false, false),
      "phase:3:shell:mount",
      "passive-on:3:shell",
      ...getBoundaries(),
      getCommit(owners, [], false),
      `layout-on:${owner}:fallback:true`,
      ...getBoundaries(),
      getCommit(owners, [], true),
      `phase:${owner}:fallback:mount`,
      `passive-on:${owner}:fallback`,
    ]);
    expect(new Set(attempts.map((attempt) => attempt.owner))).toEqual(new Set(owners));
    expect(
      attempts.every(
        (attempt) => attempt.isCurrent && attempt.isSpeculative && attempt.isDehydrated,
      ),
    ).toBe(true);
    expect(rendered).toEqual(new Set(["3:shell", `${owner}:fallback`]));
    expect(recoveries).toEqual([]);
    const originalBoundaryIds = new Map(boundaryIds);
    const fallback = getIdentity(`${owner}:fallback`);
    expect(serverSections[owner].style.display).toBe("none");
    expect(serverSections[sibling].style.display).toBe("");
    for (const host of serverHosts) {
      expect(host.isConnected).toBe(true);
      expect(getFiber(host, {})).toBeNull();
    }
    check("3:shell", serverShell);
    check("2:control", controlIdentity.host);
    rendered.clear();
    attempts.length = 0;
    const updateFallback = updateCounts.get(`${owner}:fallback`);
    if (!updateFallback) throw new Error("Missing fallback update");
    await React.act(async () => updateFallback(1));
    expect(trace.splice(0)).toEqual([
      ...getBoundaries(),
      getCommit(owners, [], true),
      `phase:${owner}:fallback:update`,
    ]);
    expect(attempts).toEqual([]);
    expect(rendered).toEqual(new Set([`${owner}:fallback`]));
    expect(boundaryIds).toEqual(originalBoundaryIds);
    expect(recoveries).toEqual([]);
    expect(serverSections[owner].style.display).toBe("none");
    check(`${owner}:fallback`, fallback.host, 1);
    rendered.clear();
    await settle(sibling);
    expect(trace.splice(0)).toEqual([
      `layout-on:${sibling}:primary:true`,
      ...getBoundaries(),
      getCommit(owners, [sibling], true),
      `phase:${sibling}:primary:mount`,
      `passive-on:${sibling}:primary`,
    ]);
    expect(rendered).toEqual(new Set([`${sibling}:primary`]));
    check(`${sibling}:primary`, serverHosts[sibling]);
    rendered.clear();
    if (deletesPending) {
      await React.act(async () => root.render(getTree([sibling])));
      expect(trace.splice(0)).toEqual([
        `delete:suspense:${owner}:true`,
        getReport(),
        `delete:activity:${owner}:true`,
        getReport(),
        `delete:marker:activity:${owner}`,
        getReport(),
        ...getDelete(`${owner}:fallback`),
        ...getBoundaries([sibling]),
        getCommit([sibling], [sibling], false),
        `passive-off:${owner}:fallback:true`,
      ]);
      retire(fallback);
      for (const kind of ["suspense", "activity"])
        expect(getFiberById(originalBoundaryIds.get(`${kind}:${owner}`) ?? -1)).toBeNull();
      expect(serverHosts[owner].isConnected).toBe(false);
      const beforeSettlement = getRoot().current;
      await settle(owner);
      expect(trace.splice(0)).toEqual([]);
      expect(rendered.size).toBe(0);
      expect(getRoot().current).toBe(beforeSettlement);
      for (const kind of ["suspense", "activity"]) boundaryIds.delete(`${kind}:${owner}`);
      await React.act(async () => root.render(getTree()));
      expect(trace.splice(0)).toEqual([
        `layout-on:${owner}:primary:true`,
        ...getBoundaries(),
        getCommit(owners, owners, false),
        `phase:${owner}:primary:mount`,
        `passive-on:${owner}:primary`,
      ]);
      for (const kind of ["suspense", "activity"])
        expect(boundaryIds.get(`${kind}:${owner}`)).not.toBe(
          originalBoundaryIds.get(`${kind}:${owner}`),
        );
    } else {
      await settle(owner);
      expect(trace.splice(0)).toEqual([
        ...getDelete(`${owner}:fallback`),
        `delete:marker:activity:${owner}`,
        getReport(),
        `layout-on:${owner}:primary:true`,
        ...getBoundaries(),
        getCommit(owners, owners, false),
        `phase:${owner}:primary:mount`,
        "recover:Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client. This can happen if a SSR-ed Client Component used:",
        `passive-off:${owner}:fallback:true`,
        `passive-on:${owner}:primary`,
      ]);
      retire(fallback);
      expect(boundaryIds).toEqual(originalBoundaryIds);
    }
    expect(recoveries).toHaveLength(deletesPending ? 0 : 1);
    expect(rendered).toEqual(new Set([`${owner}:primary`]));
    const primary = getIdentity(`${owner}:primary`);
    expect(primary.host).not.toBe(serverHosts[owner]);
    expect(serverSections[owner].isConnected).toBe(false);
    expect(serverSections[sibling].isConnected).toBe(true);
    expect(container.firstElementChild).toBe(serverMain);
    check(`${owner}:primary`, primary.host);
    check(`${sibling}:primary`, serverHosts[sibling]);
    check("3:shell", serverShell);
    check("2:control", controlIdentity.host);
    rendered.clear();
    await React.act(async () => root.unmount());
    hydrationRoot = undefined;
    expect(trace.splice(0)).toEqual([
      ...getDelete("3:shell"),
      ...owners.flatMap((checkedOwner) => [
        `delete:suspense:${checkedOwner}:true`,
        getReport(),
        `delete:activity:${checkedOwner}:true`,
        getReport(),
        ...getDelete(`${checkedOwner}:primary`),
      ]),
      "commit::false",
      "passive-off:3:shell:true",
      ...owners.map((checkedOwner) => `passive-off:${checkedOwner}:primary:true`),
    ]);
    for (const name of ["3:shell", "0:primary", "1:primary"]) retire(getIdentity(name));
    for (const identifier of boundaryIds.values()) expect(getFiberById(identifier)).toBeNull();
    await control.render(null);
    expect(trace.splice(0)).toEqual([
      ...getDelete("2:control"),
      "control:",
      "passive-off:2:control:true",
    ]);
    retire(controlIdentity);
    expect(rendered.size).toBe(0);
    return transcript;
  } finally {
    await React.act(async () => {
      hydrationRoot?.unmount();
      for (const gate of gates) {
        gate.isReady = true;
        gate.resolve();
      }
    });
    container.remove();
  }
};

it.each(
  [0, 1].flatMap((owner) => [false, true].map((deletesPending) => ({ owner, deletesPending }))),
)(
  "replays Activity hydration mismatch, owner $owner, pending deletion $deletesPending",
  async (options) => {
    expect(await runActivityHydration(options)).toEqual(await runActivityHydration(options));
  },
);
