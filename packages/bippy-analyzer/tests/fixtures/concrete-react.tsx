import * as React from "react";
import { jsx } from "react/jsx-runtime";
import * as TestRenderer from "react-test-renderer";

interface ComponentProps {
  step: number;
  order: string[];
}

interface ItemProps {
  name: string;
}

interface BoundaryProps {
  children: React.ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

const events: string[] = [];
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let props: ComponentProps = { step: 1, order: ["first", "second"] };
export let caught: Error | undefined;

const Counter = ({ step }: ComponentProps) => {
  const [count, setCount] = React.useState(0);
  React.useLayoutEffect(() => {
    events.push(`layout:${count}`);
    return () => {
      events.push(`layout-cleanup:${count}`);
    };
  }, [count]);
  React.useEffect(() => {
    events.push(`effect:${count}`);
    return () => {
      events.push(`effect-cleanup:${count}`);
    };
  }, [count]);
  return (
    <button
      id="increment"
      onClick={() => {
        setCount((previous) => previous + step);
        setCount((previous) => previous + step);
      }}
    >
      {String(count)}
    </button>
  );
};

const StepContext = React.createContext(0);
const Reducer = React.memo(() => {
  const step = React.useContext(StepContext);
  const [count, dispatch] = React.useReducer(
    (previous: number, amount: number) => previous + amount,
    0,
  );
  const identity = React.useRef({});
  const previousIdentity = React.useRef(identity.current);
  if (identity.current !== previousIdentity.current) throw new Error("Ref identity changed");
  const label = React.useMemo(() => `${count}:${step}`, [count, step]);
  React.useInsertionEffect(() => {
    events.push(`insert:${label}`);
    return () => {
      events.push(`insert-cleanup:${label}`);
    };
  }, [label]);
  return React.createElement("button", { id: "increment", onClick: () => dispatch(step) }, label);
});
const ContextReducer = ({ step }: ComponentProps) =>
  React.createElement(StepContext, { value: step }, React.createElement(Reducer));

const Item = ({ name }: ItemProps) => {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    events.push(`mount:${name}`);
    return () => {
      events.push(`unmount:${name}`);
    };
  }, [name]);
  return React.createElement(
    "button",
    { id: name, onClick: () => setCount((previous) => previous + 1) },
    `${name}:${count}`,
  );
};
const Keyed = ({ order }: ComponentProps) =>
  React.createElement(
    "section",
    null,
    order.map((name) => React.createElement(Item, { key: name, name })),
  );

class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  override state = { failed: false };
  static getDerivedStateFromError = (): BoundaryState => ({ failed: true });
  override componentDidMount = () => {
    events.push("boundary-mount");
  };
  override componentWillUnmount = () => {
    events.push("boundary-unmount");
  };
  override componentDidCatch = (error: Error) => {
    caught = error;
    events.push(`caught:${error.name}:${error.message}`);
  };
  override render = () =>
    this.state.failed ? React.createElement("p", null, "fallback") : this.props.children;
}
const Failing = () => {
  const [failed, setFailed] = React.useState(false);
  if (failed) throw new Error("fixture failure");
  return React.createElement(
    "button",
    { id: "increment", onClick: () => setFailed(true) },
    "ready",
  );
};
const ErrorBoundary = () => React.createElement(Boundary, null, React.createElement(Failing));

const AsyncEffect = () => {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    events.push("setup");
    Promise.resolve().then(() => {
      events.push("promise");
      setCount(1);
    });
    const handle = setTimeout(() => {
      events.push("timer");
      setCount((previous) => previous + 1);
    }, 0);
    return () => {
      clearTimeout(handle);
      events.push("cleanup");
    };
  }, []);
  return React.createElement("output", null, count);
};

const RenderPhase = () => {
  const [count, setCount] = React.useState(0);
  if (count < 2) setCount(count + 1);
  React.useEffect(() => {
    events.push(`committed:${count}`);
  }, [count]);
  return React.createElement("output", null, count);
};

const ExternalStore = () => {
  const store = React.useMemo(() => {
    let value = 0;
    const listeners = new Set<() => void>();
    return {
      read: () => value,
      subscribe: (listener: () => void) => {
        events.push("subscribe");
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          events.push("unsubscribe");
        };
      },
      increment: () => {
        value++;
        for (const listener of listeners) listener();
      },
    };
  }, []);
  const count = React.useSyncExternalStore(store.subscribe, store.read);
  return React.createElement("button", { id: "increment", onClick: store.increment }, count);
};

const Transition = () => {
  const [count, setCount] = React.useState(0);
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => {
    events.push(`commit:${count}:${pending}`);
  }, [count, pending]);
  return React.createElement(
    "button",
    {
      id: "increment",
      onClick: () => startTransition(() => setCount((previous) => previous + 1)),
    },
    `${count}:${pending}`,
  );
};

const components: Record<string, React.ComponentType<ComponentProps>> = {
  counter: Counter,
  context: ContextReducer,
  keyed: Keyed,
  boundary: ErrorBoundary,
  async: AsyncEffect,
  "render-phase": RenderPhase,
  store: ExternalStore,
  transition: Transition,
};
let Component: React.ComponentType<ComponentProps> = Counter;
export const owned = [React.createElement, React.useState, TestRenderer.create, Counter, jsx];
export const versions = [React.version, "version" in TestRenderer ? TestRenderer.version : null];
export const mount = (name = "counter", strict = false) => {
  Component = components[name];
  if (!Component) throw new Error(`Unknown fixture: ${name}`);
  const element = React.createElement(Component, props);
  renderer = TestRenderer.create(
    strict ? React.createElement(React.StrictMode, null, element) : element,
  );
};
export const click = (id = "increment") => {
  renderer!.root.findByProps({ id }).props.onClick();
};
export const update = (next: Partial<ComponentProps>) => {
  props = { ...props, ...next };
  renderer!.update(React.createElement(Component, props));
};
export const unmount = () => {
  renderer!.unmount();
};
export const observe = () => JSON.stringify({ tree: renderer!.toJSON(), events });
