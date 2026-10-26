import { useState } from "react";

export const ClimbingCounter = () => {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(count + 1)}>
      {count === 0 ? "low" : count === 1 ? "mid" : "high"}
    </button>
  );
};
