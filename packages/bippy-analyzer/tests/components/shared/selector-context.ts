import {
  createContext as createReactContext,
  createElement,
  type Context,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  unstable_NormalPriority as NormalPriority,
  unstable_runWithPriority as runWithPriority,
} from "scheduler";

/** The `use-context-selector` shape: the context carries a versioned value and listeners under a symbol key, and its `Provider` is replaced by a function component. */
const CONTEXT_VALUE = Symbol();

/** Preact ships no `runWithPriority`: the update is then flushed directly. */
const runWithNormalPriority = runWithPriority
  ? (flush: () => void) => {
      try {
        runWithPriority(NormalPriority, flush);
      } catch (error) {
        if (error instanceof Error && error.message === "Not implemented.") flush();
        else throw error;
      }
    }
  : (flush: () => void) => flush();

interface ContextUpdate<T> {
  n: number;
  v?: T;
}

interface ContextStore<T> {
  v: { current: T };
  n: { current: number };
  l: Set<(update: ContextUpdate<T>) => void>;
}

interface SelectorContextValue<T> {
  [CONTEXT_VALUE]: ContextStore<T>;
}

export interface SelectorContext<T> extends Context<SelectorContextValue<T>> {}

const createProvider = <T>(OriginalProvider: SelectorContext<T>["Provider"]) => {
  const ContextProvider = ({ value, children }: { value: T; children: ReactNode }) => {
    const valueRef = useRef(value);
    const versionRef = useRef(0);
    const contextValue = useRef<SelectorContextValue<T> | null>(null);
    if (!contextValue.current) {
      contextValue.current = {
        [CONTEXT_VALUE]: { v: valueRef, n: versionRef, l: new Set() },
      };
    }
    useLayoutEffect(() => {
      valueRef.current = value;
      versionRef.current += 1;
      runWithNormalPriority(() => {
        contextValue.current?.[CONTEXT_VALUE].l.forEach((listener) => {
          listener({ n: versionRef.current, v: value });
        });
      });
    }, [value]);
    return createElement(OriginalProvider, { value: contextValue.current }, children);
  };
  return ContextProvider;
};

export const createSelectorContext = <T>(defaultValue: T): SelectorContext<T> => {
  const context: SelectorContext<T> = createReactContext<SelectorContextValue<T>>({
    [CONTEXT_VALUE]: { v: { current: defaultValue }, n: { current: -1 }, l: new Set() },
  });
  context.Provider = createProvider(context.Provider);
  // @ts-expect-error the selector context has no consumer
  delete context.Consumer;
  return context;
};

export const useContextSelector = <T, Selected>(
  context: SelectorContext<T>,
  selector: (value: T) => Selected,
): Selected => {
  const {
    v: { current: value },
    n: { current: version },
    l: listeners,
  } = useContext(context)[CONTEXT_VALUE];
  const selected = selector(value);
  const [state, dispatch] = useReducer(
    (previous: [T, Selected], update?: ContextUpdate<T>): [T, Selected] => {
      if (!update) return [value, selected];
      if (update.n === version) {
        return Object.is(previous[1], selected) ? previous : [value, selected];
      }
      if ("v" in update && update.v !== undefined) {
        if (Object.is(previous[0], update.v)) return previous;
        const nextSelected = selector(update.v);
        return Object.is(previous[1], nextSelected) ? previous : [update.v, nextSelected];
      }
      return [...previous];
    },
    [value, selected],
  );
  if (!Object.is(state[1], selected)) dispatch();
  useLayoutEffect(() => {
    listeners.add(dispatch);
    return () => {
      listeners.delete(dispatch);
    };
  }, [listeners]);
  return state[1];
};
