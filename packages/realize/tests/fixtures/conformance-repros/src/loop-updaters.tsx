import { useState } from "react";

export const SetThenLoopUpdaters = () => {
  const [n, setN] = useState(0);
  return (
    <button
      onClick={() => {
        setN(1);
        for (let index = 0; index < 2; index++) setN((previous) => previous + 1);
      }}
    >
      {n === 3 ? "three" : n === 1 ? "one" : "other"}
    </button>
  );
};

export const LoopUpdatersOnly = () => {
  const [n, setN] = useState(0);
  return (
    <button
      onClick={() => {
        for (let index = 0; index < 2; index++) setN((previous) => previous + 1);
      }}
    >
      {n === 2 ? "two" : n === 1 ? "one" : "other"}
    </button>
  );
};
