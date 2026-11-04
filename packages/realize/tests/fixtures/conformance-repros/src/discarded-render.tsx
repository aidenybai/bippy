import { useState } from "react";

export const SameValueStep = ({ label }: { label?: string }) => {
  const [count, setCount] = useState(0);
  const [isStarted, setIsStarted] = useState(false);
  const handleStep = async () => {
    setIsStarted(true);
    await Promise.resolve();
    setCount((previous) => previous + 1);
  };
  return (
    <div>
      {count === 2 ? <p>{isStarted ? "two" : "idle"}</p> : label ? <em>{label}</em> : <span>{count}</span>}
      <button onClick={handleStep}>step</button>
    </div>
  );
};
