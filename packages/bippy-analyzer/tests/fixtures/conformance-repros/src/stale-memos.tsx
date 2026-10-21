import { useCallback, useMemo, useState } from "react";

type Mode = "a" | "b";

declare const sum: (items: number[]) => number;

export const StaleMemo = () => {
  const [mode, setMode] = useState<Mode>("a");
  const firstMode = useMemo(() => mode, []);
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {firstMode !== mode ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const FreshMemo = () => {
  const [mode, setMode] = useState<Mode>("a");
  const label = useMemo(() => (mode === "a" ? "first" : "second"), [mode]);
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {label === "first" ? <i>first</i> : <i>second</i>}
    </div>
  );
};

export const DerivedMemo = ({ items }: { items: number[] }) => {
  const total = sum(items);
  const label = useMemo(() => (total > 0 ? "some" : "none"), [items]);
  return <p>{label === "some" ? <i>some</i> : <i>none</i>}</p>;
};

export const StaleCallbackRead = () => {
  const [mode, setMode] = useState<Mode>("a");
  const getFirst = useCallback(() => mode, []);
  return (
    <div>
      <button onClick={() => setMode("b")}>b</button>
      {getFirst() !== mode ? <i>changed</i> : <i>same</i>}
    </div>
  );
};

export const StaleCallbackHandler = () => {
  const [isOn, setOn] = useState(false);
  const toggle = useCallback(() => setOn(!isOn), []);
  return (
    <div>
      <button onClick={toggle}>toggle</button>
      {isOn ? <i>on</i> : <i>off</i>}
    </div>
  );
};

export const FreshLoopMemo = () => {
  const [limit, setLimit] = useState(2);
  const firstOdd = useMemo(() => {
    for (let index = 0; index < limit; index++) if (index % 2 === 1) return index;
    return -1;
  }, [limit]);
  return (
    <div>
      <button onClick={() => setLimit(0)}>none</button>
      {firstOdd > 0 ? <i>found</i> : <i>missing</i>}
    </div>
  );
};

export const StaleLoopMemo = () => {
  const [limit, setLimit] = useState(2);
  const firstOdd = useMemo(() => {
    for (let index = 0; index < limit; index++) if (index % 2 === 1) return index;
    return -1;
  }, []);
  return (
    <div>
      <button onClick={() => setLimit(0)}>none</button>
      {firstOdd > 0 ? <i>found</i> : <i>missing</i>}
    </div>
  );
};
