import { useState } from "react";

export const LazyStoredAction = () => {
  const [flag, setFlag] = useState(false);
  const [count, setCount] = useState(1);
  const [stored] = useState(() => () => {
    if (count === 1) setFlag(true);
  });
  return (
    <div>
      <button onClick={() => stored()}>run</button>
      <button onClick={() => setCount(0)}>zero</button>
      <button onClick={() => setFlag(false)}>reset</button>
      {flag ? <i>yes</i> : count === 1 ? <i>no</i> : <i>other</i>}
    </div>
  );
};

export const StoredOnClick = () => {
  const [count, setCount] = useState(0);
  const [stored, setStored] = useState<() => void>(() => () => {});
  return (
    <div>
      <button onClick={stored}>run</button>
      <button onClick={() => setStored(() => () => setCount(1))}>store</button>
      {count === 1 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
