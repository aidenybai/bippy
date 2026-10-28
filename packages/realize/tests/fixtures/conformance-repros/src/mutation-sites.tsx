import { useState } from "react";

export const GuardedFirstMutation = () => {
  const [items, setItems] = useState<number[]>([1, 2]);
  return (
    <div>
      {items[0] === 1 ? <b>one</b> : <s>other</s>}
      <button
        onClick={() => {
          if (items.length > 5) items.push(1);
          items.reverse();
          setItems([...items]);
        }}
      >
        flip
      </button>
    </div>
  );
};

export const GuardedUpdaterMutation = () => {
  const [items, setItems] = useState<number[]>([1, 2]);
  return (
    <div>
      {items[0] === 1 ? <b>one</b> : <s>other</s>}
      <button
        onClick={() =>
          setItems((current) => {
            if (current.length > 5) current.push(1);
            current.reverse();
            return current.slice();
          })
        }
      >
        flip
      </button>
    </div>
  );
};

export const GuardedPendingMutation = () => {
  const [items, setItems] = useState<number[]>([1, 2]);
  return (
    <div>
      {items[0] === 1 ? <b>one</b> : <s>other</s>}
      <button
        onClick={() => {
          if (items.length > 5) items.push(1);
          items.reverse();
        }}
      >
        flip
      </button>
      <button onClick={() => setItems([...items])}>show</button>
    </div>
  );
};
