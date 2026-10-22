import { useRef, useState } from "react";

export const RefFlag = () => {
  const open = useRef(false);
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          open.current = !open.current;
          setTick(tick + 1);
        }}
      >
        flip
      </button>
      {open.current ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const RefWithoutRender = () => {
  const open = useRef(false);
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          open.current = true;
        }}
      >
        open
      </button>
      <button onClick={() => setTick(tick + 1)}>tick</button>
      {open.current ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const LazyRef = () => {
  const label = useRef<string | null>(null);
  if (label.current === null) label.current = "ready";
  return <div>{label.current === null ? <i>empty</i> : <i>{label.current}</i>}</div>;
};
