import { useState } from "react";

export const PositiveBadge = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>add</button>
      <button onClick={() => setCount(0)}>reset</button>
      {count > 0 ? <i>on</i> : <i>off</i>}
    </div>
  );
};

export const BelowLimit = () => {
  const [count, setCount] = useState(9);
  return (
    <div>
      <button onClick={() => setCount(count - 2)}>drop</button>
      <button onClick={() => setCount(9)}>reset</button>
      {count < 5 ? <i>low</i> : <i>high</i>}
    </div>
  );
};

export const LoopedOffsets = () => {
  const [n, setN] = useState(1);
  return (
    <button
      onClick={() => {
        for (let index = 0; index < 2; index++) setN((previous) => previous + 1);
      }}
    >
      {n === 1 ? "one" : n === 2 ? "two" : "other"}
    </button>
  );
};
