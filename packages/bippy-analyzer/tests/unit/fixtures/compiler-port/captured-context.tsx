// @ts-nocheck
import { useState } from "react";

const label = "outer label";

export const CapturedContext = ({ items }: { items: number[] }) => {
  const [count, setCount] = useState(0);
  const total = items.length;
  const title = "title";
  const found = 0;
  const handleClick = () => {
    const summary = { total: count, title };
    found: for (const item of items) {
      if (item > summary.total) break found;
    }
    function label() {
      return summary.title;
    }
    setCount(summary.total + total + label().length);
  };
  return (
    <button title={title} onClick={handleClick}>
      {found}
      {label}
    </button>
  );
};

export const DestructuringTarget = ({ items }: { items: number[] }) => {
  const [count, setCount] = useState(0);
  let first = 0;
  let rest: number[] = [];
  const handleClick = () => {
    [first, ...rest] = items;
    ({ count: first = 1 } = { count });
    setCount(first + rest.length);
  };
  return <button onClick={handleClick}>{count}</button>;
};
