import { useState } from "react";

export const MappedHandlers = () => {
  const [pick, setPick] = useState("a");
  const handlers = ["b", "c"].map((value) => () => setPick(value));
  return (
    <div>
      <button onClick={handlers[0]}>pb</button>
      <button onClick={handlers[1]}>pc</button>
      {pick === "a" ? <i>L1</i> : pick === "b" ? <i>L2</i> : <i>L3</i>}
    </div>
  );
};

export const CalledMappedHandler = () => {
  const [pick, setPick] = useState("a");
  const handlers = ["b", "c"].map((value) => () => setPick(value));
  return (
    <div>
      <button onClick={() => handlers[1]()}>pc</button>
      {pick === "c" ? <i>L3</i> : <i>L1</i>}
    </div>
  );
};
