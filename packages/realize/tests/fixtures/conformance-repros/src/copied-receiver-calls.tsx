import { useState } from "react";

export const SpreadSortFlag = () => {
  const [items, setItems] = useState<number[]>([]);
  const [ascending, setAscending] = useState(true);
  const visible = [...items].sort((left, right) => (ascending ? left - right : right - left));
  return (
    <div>
      <button onClick={() => setItems([...items, 1])}>add</button>
      <button onClick={() => setAscending(!ascending)}>flip</button>
      {visible.length > 0 ? <i>some</i> : <i>none</i>}
    </div>
  );
};

export const SpreadFilterFlag = () => {
  const [items, setItems] = useState<number[]>([]);
  const [flag, setFlag] = useState(true);
  const visible = [...items].filter(() => flag);
  return (
    <div>
      <button onClick={() => setItems([...items, 1])}>add</button>
      <button onClick={() => setFlag(!flag)}>flip</button>
      {visible.length > 0 ? <i>some</i> : <i>none</i>}
    </div>
  );
};

export const ConcatSomeFlag = () => {
  const [items, setItems] = useState<number[]>([]);
  const hasOne = items.concat().some((item) => item === 1);
  return <button onClick={() => setItems([...items, 1])}>{hasOne ? <i>yes</i> : <i>no</i>}</button>;
};

export const ConcatFilterFlag = () => {
  const [items, setItems] = useState<number[]>([]);
  const [flag, setFlag] = useState(true);
  const visible = items.concat().filter(() => flag);
  return (
    <div>
      <button onClick={() => setItems([...items, 1])}>add</button>
      <button onClick={() => setFlag(!flag)}>flip</button>
      {visible.length > 0 ? <i>some</i> : <i>none</i>}
    </div>
  );
};
