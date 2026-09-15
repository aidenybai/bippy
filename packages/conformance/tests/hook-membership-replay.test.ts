import {
  _renderers,
  getRDTHook,
  instrument,
  type ReactDevToolsGlobalHook,
  type ReactDevToolsTarget,
  type ReactRenderer,
} from "bippy";
import { expect, it, vi } from "vite-plus/test";
import { onRDTHookReplace, onRendererInject, type Unsubscribe } from "../../bippy/src/rdt-hook.js";

interface HookMembershipOptions {
  event: "inject" | "replace";
  cancelsOther: boolean;
  hasNested: boolean;
  cancelsFirstDuplicate: boolean;
}
interface HookMembershipListeners {
  inject: (renderer: ReactRenderer) => void;
  replace: (hook: ReactDevToolsGlobalHook, target: ReactDevToolsTarget) => void;
}

const runHookMembership = ({
  event,
  cancelsOther,
  hasNested,
  cancelsFirstDuplicate,
}: HookMembershipOptions): string[] => {
  const target: ReactDevToolsTarget = {};
  const foreignTarget: ReactDevToolsTarget = {};
  const initialHook = getRDTHook(undefined, target);
  const initialForeignHook = getRDTHook(undefined, foreignTarget);
  const renderers: ReactRenderer[] = [0, 1, 2, 3, 4].map((index) => ({
    version: "19.3.0",
    bundleType: 1,
    rendererPackageName: `hook-membership-${index}`,
  }));
  const createReplacement = (index: number): ReactDevToolsGlobalHook => {
    let identifier = 100 + index;
    return {
      renderers: new Map([[identifier, renderers[index]]]),
      inject: () => ++identifier,
      checkDCE: () => {},
      hasUnsupportedRendererAttached: false,
      on: () => {},
      onCommitFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      supportsFiber: true,
      supportsFlight: true,
    };
  };
  const replacements = renderers.map((_renderer, index) => createReplacement(index));
  const foreignReplacement = createReplacement(0);
  const trace: string[] = [];
  const transcript: string[] = [];
  const cancellations: Unsubscribe[] = [];
  const failure = new Error("hook membership observer failed");
  const reporterFailure = new Error("hook membership reporter failed");
  const record = (entry: string): void => {
    trace.push(entry);
    transcript.push(entry);
  };
  const getState = (sourceTarget = target): string => {
    const hook = sourceTarget.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) throw new Error("Missing membership hook");
    const registered = [...hook.renderers.values()];
    return `${renderers.map((renderer) => Number(registered.includes(renderer))).join("")}:${hook._instrumentationIsActive}:${registered.every((renderer) => _renderers.has(renderer))}`;
  };
  const getListeners = (
    label: string,
    callback: (index: number) => void = () => {},
    sourceTarget = target,
  ): HookMembershipListeners => ({
    inject: (renderer) => {
      const index = renderers.indexOf(renderer);
      const registered = [
        ...(sourceTarget.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers.values() ?? []),
      ];
      record(
        `${label}:${index}:${index >= 0 && registered.includes(renderer)}:${getState(sourceTarget)}`,
      );
      callback(index);
    },
    replace: (hook, replacedTarget) => {
      if (replacedTarget !== sourceTarget) return;
      const index = sourceTarget === foreignTarget ? 0 : replacements.indexOf(hook);
      record(
        `${label}:${index}:${index >= 0 && hook === (sourceTarget === foreignTarget ? foreignReplacement : replacements[index])}:${getState(sourceTarget)}`,
      );
      callback(index);
    },
  });
  const subscribe = (listeners: HookMembershipListeners, sourceTarget = target): Unsubscribe => {
    const unsubscribe =
      event === "inject"
        ? onRendererInject(listeners.inject, sourceTarget)
        : onRDTHookReplace(listeners.replace);
    cancellations.push(unsubscribe);
    return unsubscribe;
  };
  const emit = (index: number): void => {
    if (event === "inject") {
      const identifier = initialHook.inject(renderers[index]);
      record(
        `return:${index}:${identifier}:${initialHook.renderers.get(identifier) === renderers[index]}:${getState()}`,
      );
    } else {
      target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = replacements[index];
      record(
        `return:${index}:${target.__REACT_DEVTOOLS_GLOBAL_HOOK__ === replacements[index]}:${getState()}`,
      );
    }
  };
  let unsubscribeSelf = () => {};
  let unsubscribeOther = () => {};
  let renewals = 0;
  const maximumRenewalsBeforeHangGuard = 3;
  const other = getListeners("other");
  const self = getListeners("self", (index) => {
    if (index !== 0) return;
    if (renewals < maximumRenewalsBeforeHangGuard) {
      renewals++;
      unsubscribeSelf();
      if (cancelsOther) unsubscribeOther();
      unsubscribeSelf = subscribe(self);
      if (cancelsOther) unsubscribeOther = subscribe(other);
      if (hasNested && renewals === 1) emit(1);
    }
    throw failure;
  });
  using _reporter = vi
    .spyOn(console, "error")
    .mockImplementation((message: unknown, error: unknown) => {
      record(`report:${message}:${error === failure}:${getState()}`);
      throw reporterFailure;
    });
  using active = instrument({ target, onActive: () => record(`active:${getState()}`) });
  using foreignActive = instrument({
    target: foreignTarget,
    onActive: () => record(`foreign-active:${getState(foreignTarget)}`),
  });
  subscribe(
    getListeners("foreign", () => {}, foreignTarget),
    foreignTarget,
  );
  unsubscribeSelf = subscribe(self);
  unsubscribeOther = subscribe(other);
  subscribe(getListeners("last"));
  const duplicate = getListeners("duplicate");
  const duplicateCancellations = [subscribe(duplicate), subscribe(duplicate)];
  const state = (indices: number[]): string =>
    `${renderers.map((_renderer, index) => Number(indices.includes(index))).join("")}:true:true`;
  const entries = (labels: string[], index: number, indices: number[]): string[] =>
    labels.map((label) => `${label}:${index}:true:${state(indices)}`);
  const returned = (
    index: number,
    identifier: number,
    indices: number[],
    isCurrent = true,
  ): string =>
    event === "inject"
      ? `return:${index}:${identifier}:true:${state(indices)}`
      : `return:${index}:${isCurrent}:${state(indices)}`;
  const checkTrace = (expected: string[]): void => {
    expect(trace.splice(0)).toEqual(expected);
  };
  const nestedOrder = cancelsOther
    ? ["last", "duplicate", "duplicate", "self", "other"]
    : ["other", "last", "duplicate", "duplicate", "self"];
  const afterNested = hasNested ? [0, 1] : [0];
  const expectedEvent = (
    index: number,
    labels: string[],
    indices: number[],
    identifier: number,
  ): string[] => [
    ...entries(labels, index, indices),
    ...(event === "replace" ? [`active:${state(indices)}`] : []),
    returned(index, identifier, indices),
  ];
  try {
    emit(0);
    checkTrace([
      ...(event === "inject" ? [`active:${state([0])}`] : []),
      ...entries(["self"], 0, [0]),
      ...(hasNested ? expectedEvent(1, nestedOrder, [0, 1], 2) : []),
      `report:Bippy instrumentation encountered an error::true:${state(afterNested)}`,
      ...entries(
        cancelsOther
          ? ["last", "duplicate", "duplicate"]
          : ["other", "last", "duplicate", "duplicate"],
        0,
        afterNested,
      ),
      ...(event === "replace" ? [`active:${state(afterNested)}`] : []),
      returned(0, 1, afterNested, !hasNested),
    ]);
    expect(renewals).toBe(1);
    if (event === "inject") {
      emit(0);
      checkTrace([returned(0, hasNested ? 3 : 2, afterNested)]);
    }
    if (event === "inject") expect(initialForeignHook.inject(renderers[0])).toBe(1);
    else foreignTarget.__REACT_DEVTOOLS_GLOBAL_HOOK__ = foreignReplacement;
    checkTrace([
      ...(event === "inject" ? [`foreign-active:${state([0])}`] : []),
      ...entries(["foreign"], 0, [0]),
      ...(event === "replace" ? [`foreign-active:${state([0])}`] : []),
    ]);
    const canceledDuplicate = cancelsFirstDuplicate ? 0 : 1;
    duplicateCancellations[canceledDuplicate]();
    duplicateCancellations[canceledDuplicate]();
    const afterSecond = [...afterNested, 2];
    emit(2);
    checkTrace(
      expectedEvent(
        2,
        cancelsOther
          ? ["last", "duplicate", "self", "other"]
          : ["other", "last", "duplicate", "self"],
        afterSecond,
        hasNested ? 4 : 3,
      ),
    );
    duplicateCancellations[1 - canceledDuplicate]();
    duplicateCancellations[1 - canceledDuplicate]();
    const afterThird = [...afterSecond, 3];
    emit(3);
    checkTrace(
      expectedEvent(
        3,
        cancelsOther ? ["last", "self", "other"] : ["other", "last", "self"],
        afterThird,
        hasNested ? 5 : 4,
      ),
    );
    for (const unsubscribe of cancellations) unsubscribe();
    active();
    foreignActive();
    emit(4);
    checkTrace([returned(4, hasNested ? 6 : 5, [...afterThird, 4])]);
    if (event === "inject") initialForeignHook.inject(renderers[1]);
    else foreignTarget.__REACT_DEVTOOLS_GLOBAL_HOOK__ = createReplacement(1);
    checkTrace([]);
    expect(_reporter.mock.results).toEqual([{ type: "throw", value: reporterFailure }]);
    return [...transcript];
  } finally {
    for (const unsubscribe of cancellations) unsubscribe();
    active();
    foreignActive();
    for (const renderer of renderers) _renderers.delete(renderer);
  }
};

const membershipEvents: HookMembershipOptions["event"][] = ["inject", "replace"];

it.each(
  membershipEvents.flatMap((event) =>
    [false, true].flatMap((cancelsOther) =>
      [false, true].flatMap((hasNested) =>
        [false, true].map((cancelsFirstDuplicate) => ({
          event,
          cancelsOther,
          hasNested,
          cancelsFirstDuplicate,
        })),
      ),
    ),
  ),
)(
  "bounds $event membership, cancels sibling $cancelsOther, nested $hasNested, cancels first duplicate $cancelsFirstDuplicate",
  (options) => {
    expect(runHookMembership(options)).toEqual(runHookMembership(options));
  },
);
