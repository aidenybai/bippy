import { useMemo, useRef, useState } from "react";

export const RefHeldTable = () => {
  const [n, setN] = useState(0);
  const table = useRef([() => setN(n + 2)]).current;
  return (
    <div>
      {n >= 4 ? <i>big</i> : n === 2 ? <i>two</i> : <i>small</i>}
      <button onClick={() => table[0]()}>run</button>
      <button onClick={() => setN(n + 1)}>inc</button>
    </div>
  );
};

export const UnusedStateBesideMemo = () => {
  const [n, setN] = useState(0);
  useState<number[]>([]);
  const [key, setKey] = useState<"first" | "second">("first");
  const table = useMemo(() => [() => setN((current) => current + 1)], []);
  return (
    <div>
      {n === 2 && key === "first" ? <i>two</i> : <i>other</i>}
      <button onClick={() => table[0]()}>run</button>
      <button onClick={() => setKey(key === "first" ? "second" : "first")}>key</button>
    </div>
  );
};
