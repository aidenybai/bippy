import { useState } from "react";

export const PushedInLoop = () => {
  const [count, setCount] = useState(2);
  const rows: number[] = [];
  for (let index = 0; index < count; index++) rows.push(index);
  return (
    <button onClick={() => setCount((count + 1) % 4)}>{rows.length > 2 ? "many" : "few"}</button>
  );
};

export const IsArrayCheck = () => {
  const [items, setItems] = useState<number[]>([1, 3]);
  const [flag, setFlag] = useState(false);
  return (
    <div>
      <button onClick={() => setItems([...items, 1])}>add</button>
      <button onClick={() => setFlag(!flag)}>flip</button>
      {Array.isArray(items) ? <i>yes</i> : <i>no</i>}
      {flag ? <b>on</b> : <b>off</b>}
    </div>
  );
};
