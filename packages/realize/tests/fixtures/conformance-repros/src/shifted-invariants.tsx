import { useCallback, useState } from "react";

export const ClimbingCounter = () => {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(count + 1)}>
      {count === 0 ? "low" : count === 1 ? "mid" : "high"}
    </button>
  );
};

export const StaleClimbingCounter = () => {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount(count + 1), []);
  return (
    <div>
      {count === 0 ? "low" : count === 1 ? "mid" : "high"}
      <button onClick={increment}>a</button>
      <button onClick={() => setCount(5)}>b</button>
    </div>
  );
};
