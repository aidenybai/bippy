import { useState } from "react";

export const LocalTernary = () => {
  const [pick, setPick] = useState("a");
  const advance = pick === "a" ? () => setPick("b") : () => setPick("c");
  return (
    <div>
      <button onClick={() => advance()}>go</button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const SwappedTernary = () => {
  const [pick, setPick] = useState("a");
  const advance = pick !== "a" ? () => setPick("c") : () => setPick("b");
  return (
    <div>
      <button onClick={() => advance()}>go</button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const TableCall = () => {
  const [pick, setPick] = useState("a");
  const table: Partial<Record<string, () => void>> = {
    a: () => setPick("b"),
    b: () => setPick("c"),
  };
  return (
    <div>
      <button onClick={() => table[pick]?.()}>go</button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const FieldCall = () => {
  const [pick, setPick] = useState("a");
  const handlers = { advance: pick === "a" ? () => setPick("b") : () => setPick("c") };
  return (
    <div>
      <button onClick={() => handlers.advance()}>go</button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const DirectTernary = () => {
  const [pick, setPick] = useState("a");
  const advance = pick === "a" ? () => setPick("b") : () => setPick("c");
  return (
    <div>
      <button onClick={advance}>go</button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const FoundCall = () => {
  const [pick, setPick] = useState("a");
  const steps = [() => setPick("b"), () => setPick("c")];
  return (
    <div>
      <button onClick={() => steps[1]()}>skip</button>
      <button onClick={() => steps.find((_, position) => position === (pick === "a" ? 0 : 1))?.()}>
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const FilteredCall = () => {
  const [pick, setPick] = useState("a");
  const steps = [() => setPick("b"), () => setPick("c")];
  return (
    <div>
      <button
        onClick={() => steps.filter((_, position) => position === (pick === "a" ? 0 : 1))[0]?.()}
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};
