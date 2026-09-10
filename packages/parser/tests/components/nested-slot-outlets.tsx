import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useReducer,
  type ReactNode,
  type RefCallback,
} from "react";
import { createPortal } from "react-dom";

// A slot registry: an outlet renders its host once a consumer has mounted for
// it, the host's ref registers the node, and the consumer portals into it. A
// consumer mounted inside another consumer's portal only mounts on the path
// where the outer element was registered, so every state it leaves behind is
// decided with that path, and reading the registry outside the portal must
// reuse that decision rather than fork a new one per read.

interface SlotEntry {
  counter: number;
  element: HTMLElement | null;
}

type SlotState = Partial<Record<string, SlotEntry>>;

interface SlotAction {
  type: "increment" | "decrement" | "register" | "unregister";
  name: string;
  element?: HTMLElement | null;
}

const EMPTY_ENTRY: SlotEntry = { counter: 0, element: null };

const reduceSlots = (state: SlotState, action: SlotAction): SlotState => {
  const entry = state[action.name] ?? EMPTY_ENTRY;
  switch (action.type) {
    case "increment":
      return { ...state, [action.name]: { ...entry, counter: entry.counter + 1 } };
    case "decrement":
      return { ...state, [action.name]: { ...entry, counter: entry.counter - 1 } };
    case "register":
      return { ...state, [action.name]: { ...entry, element: action.element ?? null } };
    case "unregister":
      return { ...state, [action.name]: { ...entry, element: null } };
  }
};

type SlotContextValue = [SlotState, (action: SlotAction) => void];

const SlotContext = createContext<SlotContextValue | null>(null);

const SlotProvider = ({ children }: { children: ReactNode }) => {
  const value = useReducer(reduceSlots, {});
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
};

const useSlots = (): SlotContextValue => {
  const context = useContext(SlotContext);
  if (!context) throw new Error("slots need a provider");
  return context;
};

interface OutletProps {
  name: string;
  children: (props: { ref: RefCallback<HTMLElement> }, hasContent: boolean) => ReactNode;
}

const SlotOutlet = ({ name, children }: OutletProps) => {
  const [state, dispatch] = useSlots();
  const ref = useCallback<RefCallback<HTMLElement>>(
    (element) => {
      if (element) dispatch({ type: "register", name, element });
      else dispatch({ type: "unregister", name });
    },
    [dispatch, name],
  );
  return children({ ref }, (state[name]?.counter ?? 0) > 0);
};

const SlotConsumer = ({ name, children }: { name: string; children: ReactNode }) => {
  const [state, dispatch] = useSlots();
  const element = state[name]?.element;
  useLayoutEffect(() => {
    dispatch({ type: "increment", name });
    return () => dispatch({ type: "decrement", name });
  }, [dispatch, name]);
  if (!element) return null;
  return createPortal(children, element);
};

const Layout = () => (
  <div className="layout">
    <SlotOutlet name="header">
      {(props, hasHeader) => (hasHeader ? <header {...props} /> : null)}
    </SlotOutlet>
    <SlotOutlet name="content">
      {(props, hasContent) => (hasContent ? <main {...props} /> : null)}
    </SlotOutlet>
  </div>
);

const Page = () => (
  <SlotConsumer name="content">
    <article>
      <SlotConsumer name="header">
        <h1>title</h1>
      </SlotConsumer>
      <p>body</p>
    </article>
  </SlotConsumer>
);

export const isExact = true;

export default function NestedSlotOutlets() {
  return (
    <SlotProvider>
      <Layout />
      <Page />
    </SlotProvider>
  );
}
