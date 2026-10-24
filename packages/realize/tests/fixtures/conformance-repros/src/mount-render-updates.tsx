import { useState } from "react";

export const RenderSetOnMount = () => {
  const [on, setOn] = useState(true);
  const [seen, setSeen] = useState(0);
  if (on && seen !== -1) {
    setSeen(-1);
  }
  return (
    <div>
      <button onClick={() => setOn(!on)}>flip</button>
      {seen === -1 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const RenderSetAlways = () => {
  const [seen, setSeen] = useState(0);
  if (seen !== -1) setSeen(-1);
  return <div>{seen === -1 ? <i>yes</i> : <i>no</i>}</div>;
};

export const SyncedFromCount = () => {
  const [count, setCount] = useState(1);
  const [seen, setSeen] = useState(0);
  const [mark, setMark] = useState(0);
  if (count !== seen) {
    setSeen(count);
    setMark(0);
  }
  return (
    <div>
      <button onClick={() => setCount(count === 2 ? 1 : 2)}>count</button>
      <button onClick={() => setMark(mark + 1)}>mark</button>
      {count === 2 ? <i>two</i> : <i>one</i>}
      {mark >= 2 ? <i>high</i> : <i>low</i>}
    </div>
  );
};

export const SyncedSeen = () => {
  const [count, setCount] = useState(1);
  const [seen, setSeen] = useState(0);
  if (count !== seen) setSeen(count);
  return (
    <div>
      <button onClick={() => setCount(count === 2 ? 1 : 2)}>count</button>
      {seen === 1 ? <i>one</i> : <i>other</i>}
    </div>
  );
};
