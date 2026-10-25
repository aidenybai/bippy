import { useState } from "react";

export const CapturedIncrement = () => {
  const [n, setN] = useState(0);
  return (
    <button
      onClick={() => {
        let value = 1;
        const read = () => value;
        value++;
        setN(read());
      }}
    >
      {n === 2 ? "two" : n === 1 ? "one" : "zero"}
    </button>
  );
};

export const IncrementAfterClosure = () => {
  const [n, setN] = useState(5);
  return (
    <button
      onClick={() => {
        let value = 1;
        value = (() => value - 1)();
        value++;
        setN(value);
      }}
    >
      {n === 1 ? "one" : n === 0 ? "zero" : "other"}
    </button>
  );
};
