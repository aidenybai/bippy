import { useState } from "react";

const isHigh = (value: number) => value > 1;

function describe(value: number) {
  if (value > 2) return "big";
  return "small";
}

export const ModuleHelper = () => {
  const [n, setN] = useState(1);
  return <button onClick={() => setN(n + 1)}>{isHigh(n) ? "yes" : "no"}</button>;
};

export const ModuleFunctionHelper = () => {
  const [n, setN] = useState(1);
  return <button onClick={() => setN(n + 1)}>{describe(n) === "big" ? "yes" : "no"}</button>;
};

export const RecurseAfterSet = () => {
  const [n, setN] = useState(5);
  const go = (steps: number) => {
    if (steps <= 0) return;
    setN((previous) => previous + 1);
    go(steps - 1);
  };
  return (
    <button
      onClick={() => {
        setN(0);
        go(2);
      }}
    >
      {n === 2 ? "two" : n === 1 ? "one" : "other"}
    </button>
  );
};
