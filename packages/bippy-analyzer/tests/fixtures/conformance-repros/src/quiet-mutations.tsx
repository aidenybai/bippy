import { useState } from "react";
import { emit } from "event-bus";

export const SameReferenceSet = () => {
  const [items, setItems] = useState<number[]>([1]);
  return (
    <div>
      <button
        onClick={() => {
          items[0] = 2;
          setItems(items);
        }}
      >
        write
      </button>
      <button onClick={() => items.splice(0, 1)}>drop</button>
      {items.length === 0 ? <i>none</i> : items.length === 1 ? <i>one</i> : <i>many</i>}
    </div>
  );
};

export const NotifyAfterPush = () => {
  const [items] = useState<number[]>([1]);
  return (
    <div>
      <button
        onClick={() => {
          items.push(2);
          emit("pushed");
        }}
      >
        push
      </button>
      {items.length > 1 ? <i>many</i> : <i>one</i>}
    </div>
  );
};
