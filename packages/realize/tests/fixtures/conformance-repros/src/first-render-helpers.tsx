import { useState } from "react";

const cycle = (value: number) => (value >= 3 ? 0 : value + 1);

const clamp = (value: number) => Math.max(1, Math.min(2, value));

const double = (value: number) => value * 2;

export const CycledHelper = () => {
  const [n, setN] = useState(1);
  return <button onClick={() => setN(n + 1)}>{cycle(n) === 2 ? <i>two</i> : <i>other</i>}</button>;
};

export const ClampedHelper = () => {
  const [n, setN] = useState(5);
  return <button onClick={() => setN(n - 1)}>{clamp(n) === 2 ? <i>high</i> : <i>low</i>}</button>;
};

export const DoubledHelper = () => {
  const [n, setN] = useState(2);
  return (
    <button onClick={() => setN(n + 1)}>{double(n) === 4 ? <i>four</i> : <i>other</i>}</button>
  );
};
