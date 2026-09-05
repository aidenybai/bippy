import * as React from "react";
import "react-dom/client";
import { getRDTHook } from "bippy";
import { BippyHookInspectionError, getFiberHooks, inspectHooks } from "bippy/source";
import { describe, expect, it } from "vite-plus/test";
import { createFiber } from "./fiber-fixture.js";
import { getStateValues } from "./hook-tree.js";

const readMemoCache = (size: number): unknown[] => {
  const renderer = [...getRDTHook().renderers.values()].find(
    (renderer) => renderer.currentDispatcherRef,
  );
  const reference = renderer?.currentDispatcherRef;
  if (!reference) throw new Error("Missing dispatcher reference");
  const dispatcher = "H" in reference ? reference.H : reference.current;
  if (typeof dispatcher !== "object" || dispatcher === null) throw new Error("Missing dispatcher");
  const getCache = Reflect.get(dispatcher, "useMemoCache");
  if (typeof getCache !== "function") throw new Error("Missing memo-cache dispatcher");
  const slots: unknown = Reflect.apply(getCache, dispatcher, [size]);
  if (!Array.isArray(slots)) throw new Error("Invalid memo cache");
  return slots;
};

describe("inspection must not corrupt React bookkeeping", () => {
  it.each([false, true])(
    "does not mutate compiler memo slots or index, render throws = %s",
    (shouldThrow) => {
      const originalSlots = ["committed input", "committed output"];
      const memoCache = { data: [originalSlots], index: 1 };
      const snapshots: unknown[][] = [];
      const Component = () => {
        const slots = readMemoCache(2);
        snapshots.push([...slots]);
        slots[0] = "inspection-only write";
        readMemoCache(3)[0] = "new slot";
        if (shouldThrow) throw new Error("inspection failed");
        return null;
      };
      const fiber = createFiber({
        type: Component,
        elementType: Component,
        updateQueue: { memoCache },
      });
      for (let iteration = 0; iteration < 2; iteration++) {
        if (shouldThrow)
          expect(() => getFiberHooks(fiber)).toThrow("render the inspected component");
        else getFiberHooks(fiber);
        expect(memoCache).toEqual({ data: [["committed input", "committed output"]], index: 1 });
        expect(memoCache.data[0]).toBe(originalSlots);
      }
      expect(snapshots).toEqual([originalSlots, originalSlots]);
    },
  );

  it("rejects reentrant inspection without stealing the outer hook log", () => {
    const Nested = () => {
      React.useState("nested");
      return null;
    };
    let nestedError: unknown;
    const Component = () => {
      React.useState("before");
      try {
        inspectHooks(Nested, {});
      } catch (error) {
        nestedError = error;
      }
      React.useState("after");
      return null;
    };
    const tree = inspectHooks(Component, {});
    expect(nestedError).toBeInstanceOf(BippyHookInspectionError);
    expect(getStateValues(tree)).toEqual(["before", "after"]);
    expect(getStateValues(inspectHooks(Nested, {}))).toEqual(["nested"]);
  });

  it("restores the dispatcher and console after a render failure", () => {
    const reference = [...getRDTHook().renderers.values()].find(
      (renderer) => renderer.currentDispatcherRef,
    )?.currentDispatcherRef;
    if (!reference) throw new Error("Missing dispatcher reference");
    const getDispatcher = () => ("H" in reference ? reference.H : reference.current);
    const originalDispatcher = getDispatcher();
    const originalConsole = console.error;
    const failure = new Error("user error");
    expect(() =>
      inspectHooks(() => {
        React.useState(1);
        throw failure;
      }, {}),
    ).toThrow();
    expect(getDispatcher()).toBe(originalDispatcher);
    expect(console.error).toBe(originalConsole);
    expect(
      getStateValues(
        inspectHooks(() => {
          React.useState(2);
          return null;
        }, {}),
      ),
    ).toEqual([2]);
  });
});
