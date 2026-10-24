import { useState } from "react";

const NEXT: Record<string, string> = { a: "b", b: "a" };

const ORDER = ["a", "b"] as const;

const LIMITS = { min: 1, max: 3 };

const MUTABLE: Record<string, string> = { a: "b" };

const SETTINGS = { flag: "a" };

const settingsAlias = SETTINGS;

settingsAlias.flag = "b";

export const RecordHelper = () => {
  const [pick, setPick] = useState("a");
  return (
    <div>
      <button onClick={() => setPick(NEXT[pick] ?? "a")}>go</button>
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>Z1</i>}
    </div>
  );
};

export const OrderHelper = () => {
  const [index, setIndex] = useState(0);
  return (
    <div>
      <button onClick={() => setIndex((index + 1) % ORDER.length)}>go</button>
      {ORDER[index] === "a" ? <i>L1</i> : ORDER[index] === "b" ? <i>L2</i> : <i>Z1</i>}
    </div>
  );
};

export const LimitHelper = () => {
  const [count, setCount] = useState(LIMITS.min);
  return (
    <div>
      <button onClick={() => setCount(Math.min(count + 1, LIMITS.max))}>go</button>
      {count > LIMITS.max ? <i>Z1</i> : count === LIMITS.max ? <i>full</i> : <i>room</i>}
    </div>
  );
};

export const MutatedHelper = () => {
  const [pick, setPick] = useState("a");
  return (
    <div>
      <button
        onClick={() => {
          MUTABLE.a = "c";
          setPick(MUTABLE[pick] ?? "a");
        }}
      >
        go
      </button>
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>L3</i>}
    </div>
  );
};

export const AliasedConstant = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>go</button>
      {SETTINGS.flag === "b" ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
