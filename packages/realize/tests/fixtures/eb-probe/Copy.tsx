import { useState } from "react";

const touchFirst = (value: { count: number }[]) => {
  value[0].count++;
};

const touchAll = (value: { count: number }[]) => {
  for (const item of value) item.count++;
};

export const IndexSpread = () => {
  const [items] = useState([{ count: 0 }]);
  touchFirst([...items]);
  return <p>{items.length}</p>;
};

export const LoopSlice = () => {
  const [items] = useState([{ count: 0 }]);
  touchAll(items.slice());
  return <p>{items.length}</p>;
};

export const LoopDirect = () => {
  const [items] = useState([{ count: 0 }]);
  touchAll(items);
  return <p>{items.length}</p>;
};

export const IndexFrom = () => {
  const [items] = useState([{ count: 0 }]);
  touchFirst(Array.from(items));
  return <p>{items.length}</p>;
};
