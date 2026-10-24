import { useRef, useState } from "react";

export const RefHandler = () => {
  const [isDone, setIsDone] = useState(false);
  const go = useRef(() => setIsDone(true));
  return (
    <div>
      <button onClick={go.current}>go</button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const CalledRefHandler = () => {
  const [pick, setPick] = useState("a");
  const pickNext = useRef((value: string) => setPick(value));
  return (
    <div>
      <button onClick={() => pickNext.current("b")}>go</button>
      {pick === "b" ? <i>L2</i> : <i>L1</i>}
    </div>
  );
};

export const WrittenRefHandler = () => {
  const [isDone, setIsDone] = useState(false);
  const go = useRef(() => setIsDone(true));
  return (
    <div>
      <button onClick={() => go.current()}>go</button>
      <button
        onClick={() => {
          go.current = () => setIsDone(false);
        }}
      >
        swap
      </button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
