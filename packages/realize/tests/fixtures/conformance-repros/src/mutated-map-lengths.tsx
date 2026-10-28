import { useRef, useState } from "react";

export const PushThenMap = () => {
  const [items, setItems] = useState<number[]>([1]);
  return (
    <div>
      {items.length === 2 ? <b>two</b> : <s>other</s>}
      <button
        onClick={() => {
          items.push(1);
          setItems(items.map((item) => item));
        }}
      >
        grow
      </button>
    </div>
  );
};

export const SpliceThenMap = () => {
  const [items, setItems] = useState<number[]>([1, 2, 0]);
  return (
    <div>
      {items.length === 2 ? <b>two</b> : <s>other</s>}
      <button
        onClick={() => {
          items.splice(0, 1);
          setItems(items.map((item) => item + 1));
        }}
      >
        cut
      </button>
    </div>
  );
};

export const PendingPushThenMap = () => {
  const [items, setItems] = useState<number[]>([1]);
  return (
    <div>
      {items.length === 2 ? <b>two</b> : <s>other</s>}
      <button onClick={() => items.push(2)}>push</button>
      <button onClick={() => setItems(items.map((item) => item))}>copy</button>
    </div>
  );
};

export const MountClosureMap = () => {
  const [items, setItems] = useState<number[]>([1, 2]);
  const restore = useRef(() => setItems(items.map((item) => item)));
  return (
    <div>
      {items.length === 2 ? <b>two</b> : <s>other</s>}
      <button onClick={() => setItems([2])}>shrink</button>
      <button onClick={() => restore.current()}>restore</button>
    </div>
  );
};
