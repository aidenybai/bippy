import { useState } from "react";

export const Stepper = () => {
  const [count, setCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const step = (by: number, isRecorded: boolean) => {
    setCount(count + by);
    if (isRecorded) setLog([...log, `+${by}`]);
  };
  return (
    <div>
      <button onClick={() => step(1, false)}>+1</button>
      <button onClick={() => step(5, true)}>+5</button>
      <p>{count}</p>
      <ul>
        {log.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  );
};
