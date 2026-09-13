import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";

// Named-slot layout in the style of Sentry's `Slot`: outlets register their DOM
// node through a callback ref into a reducer, and consumers portal their
// children into the registered node once it exists.

interface SlotValue {
  counter: number;
  element: HTMLElement | null;
}

type SlotState = Partial<Record<string, SlotValue>>;

type SlotAction =
  | { type: "increment counter"; name: string }
  | { type: "decrement counter"; name: string }
  | { type: "register"; name: string; element: HTMLElement | null }
  | { type: "unregister"; name: string };

type SlotContextValue = [SlotState, Dispatch<SlotAction>];

const EMPTY_STATE: SlotState = {};
const NOOP_DISPATCH: Dispatch<SlotAction> = () => {};

function reducer(state: SlotState, action: SlotAction): SlotState {
  switch (action.type) {
    case "increment counter": {
      const current = state[action.name];
      return {
        ...state,
        [action.name]: {
          element: current?.element ?? null,
          counter: (current?.counter ?? 0) + 1,
        },
      };
    }
    case "decrement counter": {
      const current = state[action.name];
      if (!current) return state;
      return { ...state, [action.name]: { ...current, counter: current.counter - 1 } };
    }
    case "register":
      return {
        ...state,
        [action.name]: { counter: state[action.name]?.counter ?? 0, element: action.element },
      };
    case "unregister": {
      const current = state[action.name];
      if (!current) return state;
      return { ...state, [action.name]: { counter: current.counter, element: null } };
    }
    default:
      return state;
  }
}

const SlotContext = createContext<SlotContextValue | null>(null);
const OutletNameContext = createContext<string | null>(null);

function SlotProvider({ children }: { children: ReactNode }) {
  const [value, dispatch] = useReducer(reducer, {});
  const contextValue = useMemo(() => [value, dispatch] satisfies SlotContextValue, [value]);
  return <SlotContext.Provider value={contextValue}>{children}</SlotContext.Provider>;
}

function SlotConsumer({ name, children }: { name: string; children: ReactNode }) {
  const ctx = useContext(SlotContext);
  const [state, dispatch] = ctx ?? [EMPTY_STATE, NOOP_DISPATCH];
  const element = state[name]?.element;

  useLayoutEffect(() => {
    if (dispatch === NOOP_DISPATCH) return;
    dispatch({ type: "increment counter", name });
    return () => dispatch({ type: "decrement counter", name });
  }, [dispatch, name]);

  if (!ctx) return null;
  if (!element) return null;

  return createPortal(
    <OutletNameContext.Provider value={name}>{children}</OutletNameContext.Provider>,
    element,
  );
}
SlotConsumer.displayName = "Slot.Consumer";

function SlotOutlet({
  name,
  children,
}: {
  name: string;
  children: (props: { ref: RefCallback<HTMLElement | null> }, hasConsumers: boolean) => ReactNode;
}) {
  const ctx = useContext(SlotContext);
  const [, dispatch] = ctx ?? [EMPTY_STATE, NOOP_DISPATCH];

  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (dispatch === NOOP_DISPATCH) return;
      if (!element) {
        dispatch({ type: "unregister", name });
        return;
      }
      dispatch({ type: "register", name, element });
    },
    [dispatch, name],
  );

  if (!ctx) return children({ ref: () => {} }, false);

  return (
    <OutletNameContext.Provider value={name}>
      {children({ ref }, (ctx[0][name]?.counter ?? 0) > 0)}
    </OutletNameContext.Provider>
  );
}
SlotOutlet.displayName = "Slot.Outlet";

function Layout({ children }: { children: ReactNode }) {
  return (
    <SlotProvider>
      <main>
        <header>
          <SlotOutlet name="header">
            {({ ref }, hasConsumers) => (
              <div ref={ref} className={hasConsumers ? "filled" : "empty"} />
            )}
          </SlotOutlet>
        </header>
        <SlotOutlet name="content">{({ ref }) => <section ref={ref} />}</SlotOutlet>
        <SlotOutlet name="footer">
          {({ ref }, hasConsumers) => (hasConsumers ? <footer ref={ref} /> : null)}
        </SlotOutlet>
        {children}
      </main>
    </SlotProvider>
  );
}

export default function PortalSlots() {
  return (
    <Layout>
      <SlotConsumer name="header">
        <h1>Title</h1>
      </SlotConsumer>
      <SlotConsumer name="content">
        <p>Body</p>
        <p>More</p>
      </SlotConsumer>
      <SlotConsumer name="missing">
        <span>never shown</span>
      </SlotConsumer>
    </Layout>
  );
}
