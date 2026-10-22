import { useRef, useState } from "react";

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

export const RenderStoredRef = () => {
  const [count, setCount] = useState(0);
  const stored = useRef(() => {});
  if (count === 2)
    stored.current = () => {
      setCount(1);
    };
  return (
    <div>
      <button onClick={() => setCount(2)}>two</button>
      <button onClick={stored.current}>run</button>
      <button onClick={() => stored.current()}>call</button>
      {count === 1 ? <i>one</i> : count === 2 ? <i>two</i> : <i>zero</i>}
    </div>
  );
};

export const ReplacedInitial = () => {
  const [isOn, setIsOn] = useState(true);
  const [items, setItems] = useState<number[]>([]);
  const [keep, setKeep] = useState<() => void>(() => () => setItems([1, 1]));
  return (
    <div>
      <button onClick={() => keep()}>run</button>
      <button onClick={() => setKeep(() => () => setIsOn(false))}>replace</button>
      {items.length > 1 ? <i>many</i> : <i>few</i>}
      {isOn ? <i>on</i> : null}
    </div>
  );
};

export const RefThenUpdater = () => {
  const [count, setCount] = useState(2);
  const stored = useRef(() => {});
  return (
    <div>
      <button
        onClick={() => {
          stored.current = () => setCount(1);
        }}
      >
        store
      </button>
      <button
        onClick={() => {
          stored.current();
          setCount((value) => (value + 1) % 3);
        }}
      >
        step
      </button>
      {count === 1 ? <i>one</i> : count === 2 ? <i>two</i> : <i>zero</i>}
    </div>
  );
};
