import { useEffect, useLayoutEffect, useReducer, useState } from "react";

interface CounterState {
  count: number;
  isReady: boolean;
}

type CounterAction = { type: "ready" } | { type: "increment"; by: number };

const counterReducer = (state: CounterState, action: CounterAction): CounterState => {
  switch (action.type) {
    case "ready":
      return { ...state, isReady: true };
    case "increment":
      return { ...state, count: state.count + action.by };
  }
};

const MountedBadge = () => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  return isMounted ? <span>mounted</span> : <em>mounting</em>;
};

const Measured = () => {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    setHeight(42);
  }, []);
  return height === null ? null : <div style={{ height }}>measured</div>;
};

const Dispatcher = () => {
  const [state, dispatch] = useReducer(counterReducer, { count: 0, isReady: false });
  useEffect(() => {
    dispatch({ type: "ready" });
    dispatch({ type: "increment", by: 2 });
  }, []);
  return (
    <section>
      {state.isReady ? <strong>ready</strong> : <small>waiting</small>}
      {Array.from({ length: state.count }, (_, index) => (
        <i key={index}>{index}</i>
      ))}
    </section>
  );
};

const Reporter = ({ onReport }: { onReport: (value: string) => void }) => {
  useEffect(() => {
    onReport("child reported");
  }, [onReport]);
  return <b>reporter</b>;
};

const Parent = () => {
  const [report, setReport] = useState<string | null>(null);
  return (
    <div>
      <Reporter onReport={setReport} />
      {report ? <p>{report}</p> : null}
    </div>
  );
};

const Deferred = () => {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      const value = await new Promise<string>((resolve) => setTimeout(() => resolve("later"), 0));
      if (!isCancelled) setData(value);
    };
    load();
    return () => {
      isCancelled = true;
    };
  }, []);
  return data ? <output>{data}</output> : <progress />;
};

const Settled = () => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step < 3) setStep((current) => current + 1);
  }, [step]);
  return <mark>{step}</mark>;
};

export default function StateEffects() {
  return (
    <main>
      <MountedBadge />
      <Measured />
      <Dispatcher />
      <Parent />
      <Deferred />
      <Settled />
    </main>
  );
}
