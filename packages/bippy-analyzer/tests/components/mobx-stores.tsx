import {
  action,
  autorun,
  computed,
  makeObservable,
  observable,
  reaction,
  runInAction,
  toJS,
} from "mobx";
import { Observer, enableStaticRendering, observer, useLocalObservable } from "mobx-react";
import { Component, forwardRef } from "react";
import type { ReactNode } from "react";

// MobX stores annotated with `makeObservable`, `observer` around function,
// forwardRef and class components, `Observer` render props and a local store.

enableStaticRendering(typeof window === "undefined");

class CounterStore {
  count = 2;
  label = "items";

  constructor() {
    makeObservable(this, {
      count: observable,
      label: observable.ref,
      summary: computed,
      increment: action,
      rename: action.bound,
    });
  }

  get summary(): string {
    return `${this.count} ${this.label}`;
  }

  increment(): void {
    this.count += 1;
  }

  rename(label: string): void {
    this.label = label;
  }
}

const store = new CounterStore();
store.increment();
runInAction(() => store.rename("things"));

const seen: string[] = [];
autorun(() => seen.push(store.summary));
reaction(
  () => store.count,
  (count) => seen.push(`count ${count}`),
  { fireImmediately: true },
);
const doubled = computed(() => store.count * 2);
const snapshot = toJS(store);

const Summary = observer(({ store }: { store: CounterStore }) => <p>{store.summary}</p>);

const Badge = observer(
  forwardRef<HTMLSpanElement, { children: ReactNode }>(({ children }, ref) => (
    <span ref={ref}>{children}</span>
  )),
);

const Legacy = observer(
  class Legacy extends Component<{ store: CounterStore }> {
    render() {
      return <em>{this.props.store.label}</em>;
    }
  },
);

const Local = () => {
  const local = useLocalObservable(() => ({
    open: true,
    toggle() {
      this.open = !this.open;
    },
  }));
  return local.open ? <b>open</b> : <i>closed</i>;
};

export default function Mobx() {
  return (
    <section>
      <Summary store={store} />
      <Badge>{doubled.get()}</Badge>
      <Legacy store={store} />
      <Local />
      <Observer>{() => <u>{snapshot.count}</u>}</Observer>
      <Observer render={() => <s>{seen.length}</s>} />
      <ul>
        {seen.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </section>
  );
}
