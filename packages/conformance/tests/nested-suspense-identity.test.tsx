import * as React from "react";
import { getFiberById, getFiberId, getLatestFiber, instrument, type Fiber } from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";

interface ProbeProps {
  name: string;
}

interface GateProps {
  isHidden: boolean;
  children: React.ReactNode;
}

interface ProbeIdentity {
  fiber: Fiber;
  identifier: number;
  host: HTMLElement;
}

it.each([false, true])(
  "distinguishes nested Suspense hiding from deletion, delete hidden: %s",
  async (deleteHidden) => {
    const harness = createRenderHarness();
    const pending = new Promise<void>(() => {});
    const effects: string[] = [];
    const unmounts: string[] = [];
    const retired = new Set<number>();
    let identities = new Map<string, ProbeIdentity>();
    const Probe = ({ name }: ProbeProps) => {
      React.useLayoutEffect(() => {
        effects.push(`layout-on:${name}`);
        return () => {
          effects.push(`layout-off:${name}`);
        };
      }, [name]);
      React.useEffect(() => {
        effects.push(`passive-on:${name}`);
        return () => {
          effects.push(`passive-off:${name}`);
        };
      }, [name]);
      return <span data-probe={name}>{name}</span>;
    };
    const Gate = ({ isHidden, children }: GateProps) => {
      if (isHidden) throw pending;
      return children;
    };
    using _unsubscribe = instrument({
      onCommitFiberUnmount: (_rendererId, fiber) => {
        if (fiber.type === Probe) unmounts.push(String(fiber.memoizedProps.name));
      },
    });
    const render = async (outerHidden: boolean, innerHidden: boolean) =>
      harness.render(
        <React.Suspense fallback={<Probe name="outer-fallback" />}>
          <Gate isHidden={outerHidden}>
            <section>
              <Probe name="outer" />
              <React.Suspense fallback={<Probe name="inner-fallback" />}>
                <Gate isHidden={innerHidden}>
                  <Probe name="inner" />
                </Gate>
              </React.Suspense>
            </section>
          </Gate>
        </React.Suspense>,
      );
    const check = (
      names: string[],
      visible: string[],
      expectedEffects: string[],
      deleted: string[] = [],
    ) => {
      expect(effects.splice(0)).toEqual(expectedEffects);
      expect(unmounts.splice(0)).toEqual(deleted);
      const fibers = getFiberPreorder(harness.getRoot().current).filter(
        (fiber) => fiber.type === Probe,
      );
      expect(fibers.map((fiber) => fiber.memoizedProps.name)).toEqual(names);
      const nextIdentities = new Map<string, ProbeIdentity>();
      for (const fiber of fibers) {
        const name = fiber.memoizedProps.name;
        if (typeof name !== "string") throw new Error("Invalid probe name");
        const host = fiber.child?.stateNode;
        if (!(host instanceof HTMLElement)) throw new Error(`Missing host for ${name}`);
        const identifier = getFiberId(fiber);
        const previous = identities.get(name);
        if (previous) {
          expect(identifier).toBe(previous.identifier);
          expect(host).toBe(previous.host);
          expect(getLatestFiber(previous.fiber)).toBe(fiber);
        }
        expect(retired.has(identifier)).toBe(false);
        expect(getFiberById(identifier)).toBe(fiber);
        if (fiber.alternate) {
          expect(getLatestFiber(fiber.alternate)).toBe(fiber);
          expect(getFiberId(fiber.alternate)).toBe(identifier);
        }
        nextIdentities.set(name, { fiber: previous?.fiber ?? fiber, identifier, host });
      }
      for (const [name, previous] of identities) {
        if (!nextIdentities.has(name)) retired.add(previous.identifier);
      }
      for (const identifier of retired) expect(getFiberById(identifier)).toBeNull();
      const visibleNames = [...harness.container.querySelectorAll<HTMLElement>("[data-probe]")]
        .filter((host) => {
          let ancestor: HTMLElement | null = host;
          while (ancestor && ancestor !== harness.container) {
            if (ancestor.style.display === "none") return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        })
        .map((host) => host.dataset.probe);
      expect(visibleNames).toEqual(visible);
      identities = nextIdentities;
    };

    for (let cycle = 0; cycle < 4; cycle++) {
      await render(false, false);
      check(
        ["outer", "inner"],
        ["outer", "inner"],
        ["layout-on:outer", "layout-on:inner", "passive-on:outer", "passive-on:inner"],
      );
      await render(false, true);
      check(
        ["outer", "inner", "inner-fallback"],
        ["outer", "inner-fallback"],
        ["layout-off:inner", "layout-on:inner-fallback", "passive-on:inner-fallback"],
      );
      await render(true, true);
      check(
        ["outer", "inner", "inner-fallback", "outer-fallback"],
        ["outer-fallback"],
        [
          "layout-off:outer",
          "layout-off:inner-fallback",
          "layout-on:outer-fallback",
          "passive-on:outer-fallback",
        ],
      );
      await render(false, true);
      check(
        ["outer", "inner", "inner-fallback"],
        ["outer", "inner-fallback"],
        [
          "layout-off:outer-fallback",
          "layout-on:outer",
          "layout-on:inner-fallback",
          "passive-off:outer-fallback",
        ],
        ["outer-fallback"],
      );
      await render(false, false);
      check(
        ["outer", "inner"],
        ["outer", "inner"],
        ["layout-off:inner-fallback", "layout-on:inner", "passive-off:inner-fallback"],
        ["inner-fallback"],
      );
      if (deleteHidden) {
        await render(false, true);
        check(
          ["outer", "inner", "inner-fallback"],
          ["outer", "inner-fallback"],
          ["layout-off:inner", "layout-on:inner-fallback", "passive-on:inner-fallback"],
        );
        await render(true, true);
        check(
          ["outer", "inner", "inner-fallback", "outer-fallback"],
          ["outer-fallback"],
          [
            "layout-off:outer",
            "layout-off:inner-fallback",
            "layout-on:outer-fallback",
            "passive-on:outer-fallback",
          ],
        );
      }
      await harness.render(null);
      check(
        [],
        [],
        deleteHidden
          ? [
              "layout-off:outer-fallback",
              "passive-off:outer",
              "passive-off:inner",
              "passive-off:inner-fallback",
              "passive-off:outer-fallback",
            ]
          : ["layout-off:outer", "layout-off:inner", "passive-off:outer", "passive-off:inner"],
        deleteHidden ? ["outer", "inner", "inner-fallback", "outer-fallback"] : ["outer", "inner"],
      );
      expect(harness.container.childElementCount).toBe(0);
    }
  },
);
