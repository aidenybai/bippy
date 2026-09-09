import { isSameHookValue } from "../evaluate/hooks.js";
import { nativeFunction } from "../evaluate/stubs.js";
import { isCallable, listValue, objectFromRecord, UNDEFINED_VALUE } from "../evaluate/values.js";
import type { ReactApi, StaticValue, StubHooks, StubRenderTools } from "../types.js";

interface DependencyRevision {
  deps: StaticValue[];
  revision: number;
}

const useDependencyRevision = (hooks: StubHooks, deps: StaticValue | undefined): unknown[] => {
  const tracked = hooks.useRef<DependencyRevision | null>(null);
  if (deps?.kind !== "list") return [{}];
  const previous = tracked.current;
  const isSame =
    previous !== null &&
    previous.deps.length === deps.items.length &&
    previous.deps.every((dep, index) => isSameHookValue(dep, deps.items[index]));
  if (!isSame) tracked.current = { deps: deps.items, revision: (previous?.revision ?? 0) + 1 };
  return [tracked.current?.revision];
};

/**
 * A React API a library model calls while the reconciler renders its stub,
 * resolved against the stub's own hooks; null for APIs the stub's fiber cannot
 * host, which the caller reports as an unknown call.
 */
export const callStubHook = (
  api: ReactApi,
  args: StaticValue[],
  hooks: StubHooks,
  tools: StubRenderTools,
): StaticValue | null => {
  const [first, second] = args;
  switch (api) {
    case "useState": {
      const initial = first ?? UNDEFINED_VALUE;
      const [current, setCurrent] = hooks.useState(
        isCallable(initial) ? () => tools.call(initial, []) : initial,
      );
      const setter = hooks.useRef<StaticValue | null>(null);
      setter.current ??= nativeFunction("setState", ([next = UNDEFINED_VALUE], callTools) => {
        setCurrent(isCallable(next) ? (previous) => callTools.call(next, [previous]) : next);
        return UNDEFINED_VALUE;
      });
      return listValue([current, setter.current]);
    }
    case "useRef": {
      const ref = hooks.useRef<StaticValue | null>(null);
      ref.current ??= objectFromRecord({ current: first ?? UNDEFINED_VALUE });
      return ref.current;
    }
    case "useEffect":
    case "useLayoutEffect": {
      const deps = useDependencyRevision(hooks, second);
      const useEffect = api === "useEffect" ? hooks.useEffect : hooks.useLayoutEffect;
      useEffect(() => {
        if (!first) return;
        const cleanup = tools.call(first, []);
        return isCallable(cleanup) ? () => void tools.call(cleanup, []) : undefined;
      }, deps);
      return UNDEFINED_VALUE;
    }
    default:
      return null;
  }
};
