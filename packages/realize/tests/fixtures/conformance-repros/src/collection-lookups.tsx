import { useState } from "react";

const MODULE_LABELS = new Map([
  [0, "zero"],
  [1, "one"],
]);

export const LocalMapLabel = () => {
  const [count, setCount] = useState(0);
  const labels = new Map([
    [0, "no"],
    [1, "yes"],
  ]);
  return <button onClick={() => setCount(count === 0 ? 1 : 0)}>{labels.get(count)}</button>;
};

export const ModuleMapLabel = () => {
  const [count, setCount] = useState(1);
  return <button onClick={() => setCount(count === 0 ? 1 : 0)}>{MODULE_LABELS.get(count)}</button>;
};

export const SetMembership = () => {
  const [count, setCount] = useState(0);
  const enabled = new Set([1]);
  return (
    <button onClick={() => setCount(count === 0 ? 1 : 0)}>
      {enabled.has(count) ? "on" : "off"}
    </button>
  );
};

const TABLE_LABELS: Record<number, string> = { 0: "zero", 1: "one" };

export const TableLabel = () => {
  const [count, setCount] = useState(1);
  return <button onClick={() => setCount(count === 0 ? 1 : 0)}>{TABLE_LABELS[count]}</button>;
};
