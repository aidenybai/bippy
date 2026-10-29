import { useState } from "react";

export const NegateSelf = () => {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(-n)}>{n === 0 ? "zero" : n === 1 ? "one" : "other"}</button>;
};

export const SquareSelf = () => {
  const [n, setN] = useState(2);
  return (
    <button onClick={() => setN(n ** 2 > 100 ? 2 : n ** 2)}>
      {n === 16 ? "sixteen" : n === 3 ? "three" : "other"}
    </button>
  );
};

export const FloorSelf = () => {
  const [n, setN] = useState(8);
  return (
    <button onClick={() => setN(Math.floor(n / 2))}>
      {n === 1 ? "one" : n === 3 ? "three" : "other"}
    </button>
  );
};

export const CounterSelf = () => {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n < 0 ? "negative" : "counting"}</button>;
};
