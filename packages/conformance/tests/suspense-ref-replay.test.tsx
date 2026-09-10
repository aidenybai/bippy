import * as React from "react";
import { createPortal } from "react-dom";
import { getFiber, getFiberById, getFiberId, getLatestFiber, instrument, type Fiber } from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface RefProbeProps {
  name: string;
}

interface RefGateProps {
  isHidden: boolean;
  children: React.ReactNode;
}

interface RefIdentity {
  identifier: number;
  hostIdentifier: number;
  firstFiber: Fiber;
  host: HTMLElement;
}

const runSuspenseRefs = async (returnsCleanup: boolean): Promise<string[]> => {
  const harnesses = [createRenderHarness(), createRenderHarness()];
  const portal = document.createElement("aside");
  const pending = new Promise<void>(() => {});
  const transcript: string[] = [];
  const trace: string[] = [];
  const retired = new Set<number>();
  let identities = new Map<string, RefIdentity>();
  const record = (value: string): void => {
    trace.push(value);
    transcript.push(value);
  };
  const Probe = ({ name }: RefProbeProps) => {
    const hostIdentifier = React.useRef<number | null>(null);
    const isReleased = () =>
      hostIdentifier.current !== null && getFiberById(hostIdentifier.current) === null;
    const ref = React.useCallback(
      (host: HTMLSpanElement | null) => {
        if (host) {
          const fiber = getFiber(host);
          if (!fiber) throw new Error(`Ref has no host fiber: ${name}`);
          hostIdentifier.current = getFiberId(getLatestFiber(fiber));
          record(`ref-on:${name}:${!isReleased()}`);
          if (returnsCleanup)
            return () => {
              record(`ref-cleanup:${name}:${isReleased()}`);
            };
        } else {
          record(`ref-null:${name}:${isReleased()}`);
        }
      },
      [name],
    );
    React.useLayoutEffect(() => {
      record(`layout-on:${name}:${!isReleased()}`);
      return () => {
        record(`layout-off:${name}:${isReleased()}`);
      };
    }, [name]);
    React.useEffect(() => {
      record(`passive-on:${name}`);
      return () => {
        record(`passive-off:${name}`);
      };
    }, [name]);
    return createPortal(
      <span ref={ref} data-probe={name}>
        {name}
      </span>,
      portal,
      "shared-portal-key",
    );
  };
  const Gate = ({ isHidden, children }: RefGateProps) => {
    if (isHidden) throw pending;
    return children;
  };
  using _unsubscribe = instrument({
    onCommitFiberUnmount: (_rendererId, fiber) => {
      if (fiber.type === Probe) record(`delete:probe:${fiber.memoizedProps.name}`);
      if (fiber.type === "span") record(`delete:host:${fiber.memoizedProps["data-probe"]}`);
    },
  });
  const render = (owner: number, isHidden: boolean) =>
    harnesses[owner].render(
      <React.Suspense fallback={<Probe name={`${owner}:fallback`} />}>
        <Gate isHidden={isHidden}>
          <Probe name={`${owner}:primary`} />
        </Gate>
      </React.Suspense>,
    );
  const check = (names: string[], visibleNames: string[]) => {
    const fibers = harnesses.flatMap((harness) =>
      getFiberPreorder(harness.getRoot().current).filter((fiber) => fiber.type === Probe),
    );
    expect(fibers.map((fiber) => fiber.memoizedProps.name)).toEqual(names);
    const next = new Map<string, RefIdentity>();
    for (const fiber of fibers) {
      const name = String(fiber.memoizedProps.name);
      const hostFiber = getFiberPreorder(fiber).find((candidate) => candidate.type === "span");
      if (!hostFiber || !(hostFiber.stateNode instanceof HTMLElement))
        throw new Error(`Missing host: ${name}`);
      const host = hostFiber.stateNode;
      const identifier = getFiberId(fiber);
      const hostIdentifier = getFiberId(hostFiber);
      const previous = identities.get(name);
      if (previous) {
        expect(identifier).toBe(previous.identifier);
        expect(hostIdentifier).toBe(previous.hostIdentifier);
        expect(host === previous.host).toBe(true);
        expect(getLatestFiber(previous.firstFiber) === fiber).toBe(true);
      }
      expect(getFiberById(identifier) === fiber).toBe(true);
      expect(getFiberById(hostIdentifier) === hostFiber).toBe(true);
      expect(retired.has(identifier) || retired.has(hostIdentifier)).toBe(false);
      next.set(name, {
        identifier,
        hostIdentifier,
        host,
        firstFiber: previous?.firstFiber ?? fiber,
      });
    }
    for (const [name, previous] of identities) {
      if (!next.has(name)) {
        retired.add(previous.identifier);
        retired.add(previous.hostIdentifier);
        expect(previous.host.parentNode).toBeNull();
      }
    }
    for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
    const visible = [...portal.querySelectorAll<HTMLElement>("span")]
      .filter((host) => host.style.display !== "none")
      .map((host) => host.dataset.probe);
    expect(visible).toEqual(visibleNames);
    expect(portal.childElementCount).toBe(names.length);
    identities = next;
  };
  const refOff = returnsCleanup ? "ref-cleanup" : "ref-null";
  for (const owner of [0, 1]) {
    await render(owner, false);
    expect(trace.splice(0)).toEqual([
      `ref-on:${owner}:primary:true`,
      `layout-on:${owner}:primary:true`,
      `passive-on:${owner}:primary`,
    ]);
  }
  check(["0:primary", "1:primary"], ["0:primary", "1:primary"]);
  for (const owner of [0, 1]) {
    await render(owner, true);
    expect(trace.splice(0)).toEqual([
      `layout-off:${owner}:primary:false`,
      `${refOff}:${owner}:primary:false`,
      `ref-on:${owner}:fallback:true`,
      `layout-on:${owner}:fallback:true`,
      `passive-on:${owner}:fallback`,
    ]);
    check(
      owner === 0
        ? ["0:primary", "0:fallback", "1:primary"]
        : ["0:primary", "0:fallback", "1:primary", "1:fallback"],
      owner === 0 ? ["1:primary", "0:fallback"] : ["0:fallback", "1:fallback"],
    );
  }
  await render(0, false);
  expect(trace.splice(0)).toEqual([
    "delete:probe:0:fallback",
    "layout-off:0:fallback:false",
    "delete:host:0:fallback",
    `${refOff}:0:fallback:true`,
    "ref-on:0:primary:true",
    "layout-on:0:primary:true",
    "passive-off:0:fallback",
  ]);
  check(["0:primary", "1:primary", "1:fallback"], ["0:primary", "1:fallback"]);
  await harnesses[1].render(null);
  expect(trace.splice(0)).toEqual([
    "delete:probe:1:primary",
    "delete:host:1:primary",
    "delete:probe:1:fallback",
    "layout-off:1:fallback:false",
    "delete:host:1:fallback",
    `${refOff}:1:fallback:true`,
    "passive-off:1:primary",
    "passive-off:1:fallback",
  ]);
  check(["0:primary"], ["0:primary"]);
  await harnesses[0].render(null);
  expect(trace.splice(0)).toEqual([
    "delete:probe:0:primary",
    "layout-off:0:primary:false",
    "delete:host:0:primary",
    `${refOff}:0:primary:true`,
    "passive-off:0:primary",
  ]);
  check([], []);
  return transcript;
};

it.each([false, true])(
  "replays portal ref lifetimes across hiding, reveal and deletion, cleanup-returning ref: %s",
  async (returnsCleanup) => {
    expect(await runSuspenseRefs(returnsCleanup)).toEqual(await runSuspenseRefs(returnsCleanup));
  },
);
