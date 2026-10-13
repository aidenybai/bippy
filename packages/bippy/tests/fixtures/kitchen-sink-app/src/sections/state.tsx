import { configureStore, createSlice } from "@reduxjs/toolkit";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import { atom, useAtom } from "jotai";
import { makeAutoObservable } from "mobx";
import { observer } from "mobx-react-lite";
import { Provider as ReduxProvider, useDispatch, useSelector } from "react-redux";
import useSWR from "swr";
import { proxy, useSnapshot } from "valtio";
import { createMachine } from "xstate";
import { create } from "zustand";

import type { LibrarySection } from "../section-registry";

const queryClient = new QueryClient();

let queryFetchCount = 0;

const QueryDemo = () => {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["kitchen-sink"],
    queryFn: async () => {
      queryFetchCount++;
      return `query-data-${queryFetchCount}`;
    },
  });
  return (
    <div>
      <output data-testid="react-query-value">{isLoading ? "loading" : data}</output>
      <button data-testid="interact-react-query" onClick={() => refetch()}>
        refetch
      </button>
    </div>
  );
};

const ReactQuerySection = () => (
  <QueryClientProvider client={queryClient}>
    <QueryDemo />
  </QueryClientProvider>
);

let swrFetchCount = 0;

const SwrSection = () => {
  const { data, mutate } = useSWR("kitchen-sink", async () => {
    swrFetchCount++;
    return `swr-data-${swrFetchCount}`;
  });
  return (
    <div>
      <output data-testid="swr-value">{data ?? "loading"}</output>
      <button data-testid="interact-swr" onClick={() => mutate()}>
        revalidate
      </button>
    </div>
  );
};

interface CounterStore {
  count: number;
  increment: () => void;
}

const useZustandStore = create<CounterStore>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));

const ZustandSection = () => {
  const { count, increment } = useZustandStore();
  return (
    <button data-testid="interact-zustand" onClick={increment}>
      zustand:{count}
    </button>
  );
};

const jotaiCounterAtom = atom(0);

const JotaiSection = () => {
  const [count, setCount] = useAtom(jotaiCounterAtom);
  return (
    <button data-testid="interact-jotai" onClick={() => setCount((previous) => previous + 1)}>
      jotai:{count}
    </button>
  );
};

const valtioState = proxy({ count: 0 });

const ValtioSection = () => {
  const snapshot = useSnapshot(valtioState);
  return (
    <button data-testid="interact-valtio" onClick={() => valtioState.count++}>
      valtio:{snapshot.count}
    </button>
  );
};

const reduxSlice = createSlice({
  name: "counter",
  initialState: { count: 0 },
  reducers: {
    incremented: (state) => {
      state.count += 1;
    },
  },
});
const reduxStore = configureStore({ reducer: { counter: reduxSlice.reducer } });

interface ReduxRootState {
  counter: { count: number };
}

const ReduxCounter = () => {
  const count = useSelector((state: ReduxRootState) => state.counter.count);
  const dispatch = useDispatch();
  return (
    <button data-testid="interact-redux" onClick={() => dispatch(reduxSlice.actions.incremented())}>
      redux:{count}
    </button>
  );
};

const ReduxSection = () => (
  <ReduxProvider store={reduxStore}>
    <ReduxCounter />
  </ReduxProvider>
);

class MobxCounter {
  count = 0;
  constructor() {
    makeAutoObservable(this);
  }
  increment() {
    this.count += 1;
  }
}
const mobxCounter = new MobxCounter();

const MobxSection = observer(() => (
  <button data-testid="interact-mobx" onClick={() => mobxCounter.increment()}>
    mobx:{mobxCounter.count}
  </button>
));

const toggleMachine = createMachine({
  id: "toggle",
  initial: "inactive",
  states: {
    inactive: { on: { TOGGLE: "active" } },
    active: { on: { TOGGLE: "inactive" } },
  },
});

const XstateSection = () => {
  const [state, send] = useMachine(toggleMachine);
  return (
    <button data-testid="interact-xstate" onClick={() => send({ type: "TOGGLE" })}>
      xstate:{String(state.value)}
    </button>
  );
};

export const stateSections: LibrarySection[] = [
  { name: "react-query", Component: ReactQuerySection },
  { name: "swr", Component: SwrSection },
  { name: "zustand", Component: ZustandSection },
  { name: "jotai", Component: JotaiSection },
  { name: "valtio", Component: ValtioSection },
  { name: "react-redux", Component: ReduxSection },
  { name: "mobx-react-lite", Component: MobxSection },
  { name: "xstate", Component: XstateSection },
];
