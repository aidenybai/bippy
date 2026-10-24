import { useState } from "react";

const next = (value: string) => (value === "a" ? "b" : "a");

function flip(value: string): string {
  switch (value) {
    case "a":
      return "b";
    default:
      return "a";
  }
}

export const ArrowHelper = () => {
  const [pick, setPick] = useState("a");
  return (
    <div>
      <button onClick={() => setPick(next(pick))}>go</button>
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>Z1</i>}
    </div>
  );
};

export const FunctionHelper = () => {
  const [pick, setPick] = useState("a");
  return (
    <div>
      <button onClick={() => setPick(flip(pick))}>go</button>
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>Z1</i>}
    </div>
  );
};
