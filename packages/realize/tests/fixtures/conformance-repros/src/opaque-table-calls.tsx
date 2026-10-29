import { useMemo, useState } from "react";

const NEXT = ["b", "c"];

export const ReducedCall = () => {
  const [pick, setPick] = useState("a");
  const steps = [() => setPick("b"), () => setPick("c")];
  const position = pick === "a" ? 0 : 1;
  return (
    <div>
      <button
        onClick={() =>
          steps.reduce<(() => void) | null>(
            (found, run, index) => (index === position ? run : found),
            null,
          )?.()
        }
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const SlicedLoop = () => {
  const [pick, setPick] = useState("a");
  const steps = [() => setPick("b"), () => setPick("c")];
  const position = pick === "a" ? 0 : 1;
  return (
    <div>
      <button onClick={() => steps.slice(position, position + 1).forEach((run) => run())}>
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const EntriesLoop = () => {
  const [pick, setPick] = useState("a");
  const steps = [() => setPick("b"), () => setPick("c")];
  const position = pick === "a" ? 0 : 1;
  return (
    <div>
      <button
        onClick={() => {
          for (const [index, run] of steps.entries()) if (index === position) run();
        }}
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const MemoMappedCall = () => {
  const [pick, setPick] = useState("a");
  const steps = useMemo(() => [() => setPick("b"), () => setPick("c")], []);
  const position = pick === "a" ? 0 : 1;
  return (
    <div>
      <button
        onClick={() =>
          steps.map((run, index) => (index === position ? run : null)).find(Boolean)?.()
        }
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const SpreadTableCall = () => {
  const [pick, setPick] = useState("a");
  const steps = [...NEXT.map((next) => () => setPick(next)), () => setPick("a")];
  const position = pick === "a" ? 0 : 1;
  return (
    <div>
      <button onClick={() => steps.find((_, index) => index === position)?.()}>go</button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const LoopedRowCall = () => {
  const [pick, setPick] = useState("a");
  const rows = [
    { id: "a", run: () => setPick("b") },
    { id: "b", run: () => setPick("c") },
  ];
  return (
    <div>
      <button
        onClick={() => {
          for (const row of rows) if (row.id === pick) row.run();
        }}
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const ComputedFieldCall = () => {
  const [pick, setPick] = useState("a");
  const handlers: Record<string, () => void> = { a: () => setPick("b"), b: () => setPick("c") };
  return (
    <div>
      <button
        onClick={() => {
          const { [pick]: run } = handlers;
          run?.();
        }}
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const EntriesTableCall = () => {
  const [pick, setPick] = useState("a");
  const rows = useMemo(
    () => [
      { id: "a", run: () => setPick("b") },
      { id: "b", run: () => setPick("c") },
    ],
    [],
  );
  return (
    <div>
      <button onClick={() => Object.fromEntries(rows.map((row) => [row.id, row.run]))[pick]?.()}>
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const MemoLoopedRowCall = () => {
  const [pick, setPick] = useState("a");
  const rows = useMemo(
    () => [
      { id: "a", run: () => setPick("b") },
      { id: "b", run: () => setPick("c") },
    ],
    [],
  );
  return (
    <div>
      <button
        onClick={() => {
          for (const row of rows) if (row.id === pick) row.run();
        }}
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};

export const LoopAfterItemCall = () => {
  const [pick, setPick] = useState("a");
  const rows = [
    { id: "a", run: () => setPick("b") },
    { id: "b", run: () => setPick("c") },
  ];
  return (
    <div>
      <button onClick={() => rows.some((row) => row.id === "z" && (row.run(), true))}>none</button>
      <button
        onClick={() => {
          for (const row of rows) if (row.id === pick) row.run();
        }}
      >
        go
      </button>
      {pick === "a" ? <i>a</i> : pick === "b" ? <i>b</i> : <i>c</i>}
    </div>
  );
};
