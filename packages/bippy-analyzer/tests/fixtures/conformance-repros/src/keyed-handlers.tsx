import { useState } from "react";

export const KeyedHandler = () => {
  const [isArmed, setIsArmed] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const handlers = { armed: () => setIsDone(true), idle: () => undefined };
  return (
    <div>
      <button onClick={() => setIsArmed(true)}>arm</button>
      <button onClick={handlers[isArmed ? "armed" : "idle"]}>fire</button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
