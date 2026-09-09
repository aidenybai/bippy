import { Store, useStore } from "@tanstack/react-store";
import { useEffect, useLayoutEffect } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector.js";

interface RouterState {
  status: "idle" | "pending";
  matches: string[];
}

/** TanStack Router's shape: the store starts empty and the mount effect loads matches asynchronously. */
const routerStore = new Store<RouterState>({ status: "idle", matches: [] });

const loadMatches = async () => {
  routerStore.setState((previous) => ({ ...previous, status: "pending" }));
  await Promise.resolve();
  routerStore.setState((previous) => ({
    ...previous,
    status: "idle",
    matches: ["__root__", "/posts"],
  }));
};

const Transitioner = () => {
  useLayoutEffect(() => {
    void loadMatches();
  }, []);
  return null;
};

const Match = ({ matchId }: { matchId: string }) => {
  const index = useStore(routerStore, (state) => state.matches.indexOf(matchId));
  const childId = useStore(routerStore, (state) => state.matches[index + 1]);
  return (
    <section>
      <p>{`${index}:${matchId}`}</p>
      {childId ? <Match matchId={childId} /> : null}
    </section>
  );
};

const Matches = () => {
  const status = useStore(routerStore, (state) => state.status);
  const firstMatchId = useStore(routerStore, (state) => state.matches[0]);
  return (
    <div data-status={status}>
      <Transitioner />
      {firstMatchId ? <Match matchId={firstMatchId} /> : <em>loading</em>}
    </div>
  );
};

interface Counter {
  value: number;
}

const listeners = new Set<() => void>();
let counter: Counter = { value: 0 };

const subscribeToCounter = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getCounter = () => counter;
const increment = () => {
  counter = { value: counter.value + 1 };
  for (const listener of listeners) listener();
};

const CounterLabel = () => {
  const value = useSyncExternalStoreWithSelector(
    subscribeToCounter,
    getCounter,
    getCounter,
    (snapshot) => snapshot.value,
    Object.is,
  );
  useEffect(() => {
    increment();
  }, []);
  return <strong>{value}</strong>;
};

export default () => (
  <main>
    <Matches />
    <CounterLabel />
  </main>
);
