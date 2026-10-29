import { useState } from "react";
import { flushSync } from "react-dom";

export const FlushSyncPair = () => {
  const [count, setCount] = useState(0);
  return (
    <button
      onClick={() => {
        flushSync(() => setCount(count + 1));
        setCount(count + 1);
      }}
    >
      {count === 1 ? "one" : count === 0 ? "zero" : "other"}
    </button>
  );
};
