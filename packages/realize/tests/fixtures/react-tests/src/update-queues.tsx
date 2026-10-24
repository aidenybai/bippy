import { useReducer, useState } from "react";

type CounterAction = "increment" | "decrement";

const INITIAL_STATE = 42;

const INITIAL_PROPS = { initialCount: 10 };

const counterReducer = (state: number, action: CounterAction): number =>
  action === "increment" ? state + 1 : state - 1;

export const SimpleMountAndUpdate = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(1)}>one</button>
      <button onClick={() => setCount((current) => current + 10)}>add ten</button>
      <p>{count === 0 ? "zero" : count === 1 ? "one" : count === 11 ? "eleven" : "other"}</p>
    </div>
  );
};

export const LazyStateInitializer = () => {
  const [count, setCount] = useState(() => INITIAL_STATE);
  return (
    <div>
      <button onClick={() => setCount(7)}>seven</button>
      <p>{count === 42 ? "forty-two" : count === 7 ? "seven" : "other"}</p>
    </div>
  );
};

export const MultipleStates = () => {
  const [count, setCount] = useState(0);
  const [label, setLabel] = useState<"Count" | "Total">("Count");
  return (
    <div>
      <button onClick={() => setCount(7)}>seven</button>
      <button onClick={() => setLabel("Total")}>total</button>
      <p>{label === "Count" ? "Count" : "Total"}</p>
      <p>{count === 0 ? "zero" : count === 7 ? "seven" : "other"}</p>
    </div>
  );
};

export const BatchesStateTwice = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          setCount((current) => current + 1);
          setCount((current) => current + 1);
        }}
      >
        twice
      </button>
      <p>{count === 0 ? "zero" : count === 2 ? "two" : count === 4 ? "four" : "other"}</p>
    </div>
  );
};

export const StaleValueSetTwice = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          setCount(count + 1);
          setCount(count + 1);
        }}
      >
        twice
      </button>
      <p>{count === 0 ? "zero" : count === 1 ? "one" : count === 2 ? "two" : "other"}</p>
    </div>
  );
};

export const UpdaterAfterReplacement = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          setCount(5);
          setCount((current) => current + 1);
        }}
      >
        replace then add
      </button>
      <p>{count === 0 ? "zero" : count === 6 ? "six" : "other"}</p>
    </div>
  );
};

export const ReplacementAfterUpdater = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          setCount((current) => current + 1);
          setCount(10);
        }}
      >
        add then replace
      </button>
      <p>{count === 0 ? "zero" : count === 10 ? "ten" : "other"}</p>
    </div>
  );
};

export const BatchesTwoStates = () => {
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          setLeft(1);
          setRight(2);
        }}
      >
        both
      </button>
      <p>{left === 0 ? "left zero" : left === 1 ? "left one" : "left other"}</p>
      <p>{right === 0 ? "right zero" : right === 2 ? "right two" : "right other"}</p>
    </div>
  );
};

export const ReducerMountAndUpdate = () => {
  const [count, dispatch] = useReducer(counterReducer, 0);
  return (
    <div>
      <button onClick={() => dispatch("increment")}>increment</button>
      <button
        onClick={() => {
          dispatch("decrement");
          dispatch("decrement");
          dispatch("decrement");
        }}
      >
        decrement three times
      </button>
      <p>{count === 0 ? "zero" : count === 1 ? "one" : count === -2 ? "minus two" : "other"}</p>
    </div>
  );
};

export const ReducerLazyInit = () => {
  const [count, dispatch] = useReducer(
    counterReducer,
    INITIAL_PROPS,
    (props: { initialCount: number }) => props.initialCount,
  );
  return (
    <div>
      <button onClick={() => dispatch("increment")}>increment</button>
      <p>{count === 10 ? "ten" : count === 11 ? "eleven" : "other"}</p>
    </div>
  );
};

export const SameValueBailsOut = () => {
  const [count, setCount] = useState(0);
  const [other, setOther] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          setOther(1);
          setCount(1);
          setCount(0);
        }}
      >
        bail out
      </button>
      <p>{count === 0 ? "count zero" : count === 1 ? "count one" : "count other"}</p>
      <p>{other === 0 ? "other zero" : other === 1 ? "other one" : "other other"}</p>
    </div>
  );
};
