import { useState } from "react";

export const SliceCopyPush = () => {
  const [items, setItems] = useState<number[]>([]);
  return (
    <button
      onClick={() => {
        const next = items.slice();
        next.push(2);
        setItems(next);
      }}
    >
      {items.length > 0 ? "yes" : "no"}
    </button>
  );
};

export const FilterThenPush = () => {
  const [items, setItems] = useState<number[]>([]);
  return (
    <button
      onClick={() => {
        const next = items.filter((item) => item > 0);
        next.push(2);
        setItems(next);
      }}
    >
      {items.length > 0 ? "yes" : "no"}
    </button>
  );
};
