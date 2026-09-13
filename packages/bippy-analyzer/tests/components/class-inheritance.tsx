import * as React from "react";
import { useSyncExternalStore } from "react";

interface PopupState {
  open: boolean;
  triggerCount: number;
  label: string;
}

/** Base UI's `Store` shape: a mutable `state` replaced wholesale on every `set`. */
class Store<State extends object> {
  state: State;
  listeners = new Set<() => void>();

  constructor(state: State) {
    this.state = state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): State => this.state;

  setState(newState: State): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.listeners) listener();
  }

  set<Key extends keyof State>(key: Key, value: State[Key]): void {
    if (!Object.is(this.state[key], value)) {
      this.setState({ ...this.state, [key]: value });
    }
  }

  describe(): string {
    return "store";
  }
}

class ReactStore<State extends object> extends Store<State> {
  readonly name: string;

  constructor(state: State, name: string) {
    super(state);
    this.name = name;
  }

  useState<Key extends keyof State>(key: Key): State[Key] {
    return useSyncExternalStore(this.subscribe, () => this.state[key]);
  }

  describe(): string {
    return `${super.describe()}:${this.name}`;
  }
}

class Base {
  static kind(): string {
    return "base";
  }

  greeting(): string {
    return "hello";
  }

  get punctuation(): string {
    return "!";
  }
}

class Derived extends Base {
  static kind(): string {
    return `derived<${super.kind()}>`;
  }

  greeting(): string {
    return `${super.greeting()} world${super.punctuation}`;
  }
}

const popupStore = new ReactStore<PopupState>(
  { open: false, triggerCount: 0, label: "tooltip" },
  "popup",
);

const useSyncedTriggerCount = (store: ReactStore<PopupState>, triggerElements: Set<string>) => {
  const open = store.useState("open");
  React.useLayoutEffect(() => {
    if (!open) {
      if (store.state.triggerCount !== 0) store.set("triggerCount", 0);
      return;
    }
    store.set("triggerCount", triggerElements.size);
  }, [open, store, triggerElements]);
};

const Popup = ({ triggerElements }: { triggerElements: Set<string> }) => {
  useSyncedTriggerCount(popupStore, triggerElements);
  const open = popupStore.useState("open");
  const label = popupStore.useState("label");
  return (
    <div data-store={popupStore.describe()}>
      {open ? <span>{label}</span> : <em>closed</em>}
      {Derived.kind() === "derived<base>" ? <b>static super</b> : null}
      {new Derived().greeting() === "hello world!" ? <i>instance super</i> : null}
      {popupStore.describe() === "store:popup" ? <u>compiled store</u> : null}
    </div>
  );
};

export default function App() {
  return <Popup triggerElements={new Set(["a", "b"])} />;
}
