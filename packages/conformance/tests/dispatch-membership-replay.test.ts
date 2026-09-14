import {
  _fiberRoots,
  getFiberById,
  getFiberId,
  getRDTHook,
  getReactWorkTags,
  instrument,
  type Fiber,
  type FiberRoot,
  type ReactDevToolsTarget,
} from "bippy";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { createFiber } from "./fiber-fixture.js";

interface MembershipEvent {
  root: FiberRoot;
  fiber: Fiber;
  identifiers: number[];
  priority: number;
  didError: boolean;
  children: string;
}
interface MembershipOptions {
  event: "commit" | "unmount" | "post" | "schedule";
  cancelsOther: boolean;
  hasNested: boolean;
}

const runMembershipReplay = ({ event, cancelsOther, hasNested }: MembershipOptions): string[] => {
  const target: ReactDevToolsTarget = {};
  const foreignTarget: ReactDevToolsTarget = {};
  const hook = getRDTHook(undefined, target);
  const rendererId = hook.inject({
    version: "19.3.0",
    rendererPackageName: "membership",
    bundleType: 1,
  });
  const events: MembershipEvent[] = [0, 1, 2].map((index) => {
    const fiber = createFiber({ key: String(index) });
    const alternate = createFiber({ key: String(index) });
    const identifiers = [getFiberId(fiber), getFiberId(alternate)];
    fiber.alternate = alternate;
    alternate.alternate = fiber;
    const root: FiberRoot = {
      current: createFiber({
        tag: getReactWorkTags().HostRoot,
        child: fiber,
        memoizedState: { element: {}, memoizedState: null, next: null },
      }),
    };
    fiber.return = root.current;
    alternate.return = root.current;
    return {
      root,
      fiber,
      identifiers,
      priority: index + 1,
      didError: index === 1,
      children: `children:${index}`,
    };
  });
  const trace: string[] = [];
  const transcript: string[] = [];
  const failure = new Error("self-renewing observer failed");
  const reporterFailure = new Error("membership reporter failed");
  const getLiveness = (): string =>
    events
      .flatMap((innerEvent) =>
        innerEvent.identifiers.map((identifier) => Number(getFiberById(identifier) !== null)),
      )
      .join("");
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getOptions = (
    label: string,
    listener: (index: number) => void = () => {},
    sourceTarget = target,
  ) => {
    const notify = (kind: MembershipOptions["event"], index: number, isValid: boolean): void => {
      if (kind !== event) return;
      record(`${label}:${index}:${isValid}:${getLiveness()}`);
      listener(index);
    };
    return {
      target: sourceTarget,
      onCommitFiberRoot: (
        receivedRenderer: number,
        root: FiberRoot,
        priority: number | void,
        didError?: boolean,
      ) => {
        const index = events.findIndex((innerEvent) => innerEvent.root === root);
        notify(
          "commit",
          index,
          receivedRenderer === rendererId &&
            priority === events[index]?.priority &&
            didError === events[index]?.didError,
        );
      },
      onCommitFiberUnmount: (receivedRenderer: number, fiber: Fiber) => {
        const index = events.findIndex((innerEvent) => innerEvent.fiber === fiber);
        notify("unmount", index, receivedRenderer === rendererId && index >= 0);
      },
      onPostCommitFiberRoot: (receivedRenderer: number, root: FiberRoot) => {
        const index = events.findIndex((innerEvent) => innerEvent.root === root);
        notify("post", index, receivedRenderer === rendererId && index >= 0);
      },
      onScheduleFiberRoot: (receivedRenderer: number, root: FiberRoot, children: ReactNode) => {
        const index = events.findIndex((innerEvent) => innerEvent.root === root);
        notify(
          "schedule",
          index,
          receivedRenderer === rendererId && children === events[index]?.children,
        );
      },
    };
  };
  const previous = getOptions("previous");
  hook.onCommitFiberRoot = previous.onCommitFiberRoot;
  hook.onCommitFiberUnmount = previous.onCommitFiberUnmount;
  hook.onPostCommitFiberRoot = previous.onPostCommitFiberRoot;
  hook.onScheduleFiberRoot = previous.onScheduleFiberRoot;
  const emit = (index: number): void => {
    const entry = events[index];
    if (event === "commit")
      hook.onCommitFiberRoot(rendererId, entry.root, entry.priority, entry.didError);
    else if (event === "unmount") hook.onCommitFiberUnmount(rendererId, entry.fiber);
    else if (event === "post") hook.onPostCommitFiberRoot(rendererId, entry.root);
    else hook.onScheduleFiberRoot?.(rendererId, entry.root, entry.children);
  };
  let unsubscribeSelf = () => {};
  let unsubscribeOther = () => {};
  let renewals = 0;
  const maximumRenewalsBeforeHangGuard = 3;
  const otherOptions = getOptions("other");
  const selfOptions = getOptions("self", (index) => {
    if (index !== 0) return;
    if (renewals < maximumRenewalsBeforeHangGuard) {
      renewals++;
      unsubscribeSelf();
      if (cancelsOther) unsubscribeOther();
      unsubscribeSelf = instrument(selfOptions);
      if (cancelsOther) unsubscribeOther = instrument(otherOptions);
      if (hasNested && renewals === 1) emit(1);
    }
    throw failure;
  });
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === failure}:${getLiveness()}`);
      throw reporterFailure;
    });
  using _foreign = instrument(getOptions("foreign", () => {}, foreignTarget));
  unsubscribeSelf = instrument(selfOptions);
  unsubscribeOther = instrument(otherOptions);
  using unsubscribeLast = instrument(getOptions("last"));
  const entry = (label: string, index: number, alive: string): string =>
    `${label}:${index}:true:${alive}`;
  const nestedOrder = cancelsOther ? ["last", "self", "other"] : ["other", "last", "self"];
  try {
    emit(0);
    const afterNested = event === "unmount" && hasNested ? "110011" : "111111";
    expect(trace.splice(0)).toEqual([
      entry("previous", 0, "111111"),
      entry("self", 0, "111111"),
      ...(hasNested
        ? [entry("previous", 1, "111111"), ...nestedOrder.map((label) => entry(label, 1, "111111"))]
        : []),
      `report:Bippy instrumentation encountered an error::true:${afterNested}`,
      ...(cancelsOther ? [] : [entry("other", 0, afterNested)]),
      entry("last", 0, afterNested),
    ]);
    expect(renewals).toBe(1);
    const beforeLater = event === "unmount" ? (hasNested ? "000011" : "001111") : "111111";
    expect(getLiveness()).toBe(beforeLater);
    emit(2);
    expect(trace.splice(0)).toEqual([
      entry("previous", 2, beforeLater),
      ...nestedOrder.map((label) => entry(label, 2, beforeLater)),
    ]);
    expect(getLiveness()).toBe(event === "unmount" ? (hasNested ? "000000" : "001100") : "111111");
    return [...transcript];
  } finally {
    unsubscribeSelf();
    unsubscribeOther();
    unsubscribeLast();
    for (const entry of events) {
      hook.onCommitFiberUnmount(rendererId, entry.fiber);
      entry.root.current.memoizedState = { element: null, memoizedState: null, next: null };
      hook.onCommitFiberRoot(rendererId, entry.root, entry.priority, entry.didError);
      expect(_fiberRoots.has(entry.root)).toBe(false);
      for (const identifier of entry.identifiers) expect(getFiberById(identifier)).toBeNull();
    }
  }
};

const membershipEvents: MembershipOptions["event"][] = ["commit", "unmount", "post", "schedule"];
it.each(
  membershipEvents.flatMap((event) =>
    [false, true].flatMap((cancelsOther) =>
      [false, true].map((hasNested) => ({ event, cancelsOther, hasNested })),
    ),
  ),
)("bounds $event membership, replace sibling $cancelsOther, nested $hasNested", (options) => {
  expect(runMembershipReplay(options)).toEqual(runMembershipReplay(options));
});
