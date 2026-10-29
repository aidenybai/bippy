import { useState } from "react";

export const ComputedTable = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const actions: Record<number, () => void> = { [k]: () => setN(1), [k + 1]: () => setN(2) };
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={actions[k + 1]}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};

export const SpreadThenComputed = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const base = { 1: () => setN(1) };
  const actions: Record<number, () => void> = { ...base, [k + 2]: () => setN(2) };
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={actions[k === 0 ? 1 : 3]}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};

export const SpreadArrayTable = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const base = [() => setN(1)];
  const handlers = [...base, () => setN(2)];
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={handlers[k]}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};

export const MapWrites = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const handlers = new Map<number, () => void>();
  handlers.set(0, () => setN(1));
  handlers.set(1, () => setN(2));
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => handlers.get(k)?.()}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};

export const ReducedTable = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const handlers = [1, 2].reduce<Record<number, () => void>>(
    (all, value) => ({ ...all, [value]: () => setN(value) }),
    {},
  );
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={handlers[k + 1]}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};

export const FilteredTable = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const handlers = [
    { id: 0, run: () => setN(1) },
    { id: 1, run: () => setN(2) },
  ].filter((item) => item.id === k);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={handlers[0].run}>step</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};
