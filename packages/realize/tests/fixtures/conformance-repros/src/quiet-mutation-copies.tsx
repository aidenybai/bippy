import { useState } from "react";

export const QuietAddThenCopy = () => {
  const [ids, setIds] = useState(() => new Set([1]));
  return (
    <div>
      <button onClick={() => ids.add(5)}>quiet</button>
      <button onClick={() => setIds((previous) => new Set(previous))}>copy</button>
      {ids.has(5) ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const QuietPushThenSlice = () => {
  const [items, setItems] = useState([1]);
  return (
    <div>
      <button onClick={() => items.push(4)}>quiet</button>
      <button onClick={() => setItems(items.slice())}>copy</button>
      {items.length > 1 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
