import { useState } from "react";

export const DeepSetterChain = () => {
  const [n, setN] = useState(0);
  const step0 = (value: number) => setN(value % 3);
  const step1 = (value: number) => step0(value);
  const step2 = (value: number) => step1(value);
  const step3 = (value: number) => step2(value);
  const step4 = (value: number) => step3(value);
  return <button onClick={() => step4(n + 1)}>{n === 1 ? "one" : n === 2 ? "two" : "zero"}</button>;
};

export const RecursiveSetter = () => {
  const [n, setN] = useState(0);
  const walk = (depth: number) => {
    if (depth <= 0) {
      setN(2);
      return;
    }
    walk(depth - 1);
  };
  return <button onClick={() => walk(1)}>{n === 2 ? "two" : "zero"}</button>;
};
