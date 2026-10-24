import { useState } from "react";

export const StateHandler = () => {
  const [isDone, setIsDone] = useState(false);
  const [go] = useState(() => () => setIsDone(true));
  return (
    <div>
      <button onClick={go}>go</button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const CalledStateHandler = () => {
  const [pick, setPick] = useState("a");
  const [pickNext] = useState(() => (value: string) => setPick(value));
  return (
    <div>
      <button onClick={() => pickNext("b")}>go</button>
      {pick === "b" ? <i>L2</i> : <i>L1</i>}
    </div>
  );
};
