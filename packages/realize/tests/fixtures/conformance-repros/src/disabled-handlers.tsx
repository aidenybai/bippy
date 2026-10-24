import { useState } from "react";

export const LockedButton = () => {
  const [isReady] = useState(false);
  const [isDone, setIsDone] = useState(false);
  return (
    <div>
      <button disabled={!isReady} onClick={() => setIsDone(true)}>
        done
      </button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const UnlockedButton = () => {
  const [isReady, setIsReady] = useState(false);
  const [isDone, setIsDone] = useState(false);
  return (
    <div>
      <button onClick={() => setIsReady(true)}>ready</button>
      <button disabled={!isReady} onClick={() => setIsDone(true)}>
        done
      </button>
      {isDone ? <i>yes</i> : <i>no</i>}
    </div>
  );
};
