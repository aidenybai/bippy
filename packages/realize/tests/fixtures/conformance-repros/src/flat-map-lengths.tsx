import { useState } from "react";

export const DroppedRows = () => {
  const [items, setItems] = useState<number[]>([2, 0]);
  return (
    <div>
      {items.length === 1 ? <b>one</b> : <s>other</s>}
      <button onClick={() => setItems(items.flatMap((item) => (item === 2 ? [] : [item])))}>
        drop
      </button>
      <button onClick={() => setItems([2, 0])}>reset</button>
    </div>
  );
};

export const DoubledRows = () => {
  const [items, setItems] = useState<number[]>([1]);
  return (
    <div>
      {items.length === 2 ? <b>two</b> : <s>other</s>}
      <button onClick={() => setItems(items.flatMap((item) => [item, item]))}>double</button>
    </div>
  );
};
