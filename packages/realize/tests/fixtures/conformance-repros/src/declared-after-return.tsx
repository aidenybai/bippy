import { useState } from "react";

export const Stepper = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={decrement}>-</button>
      {count > 0 ? <span>{count}</span> : <span>Empty</span>}
      <button onClick={increment}>+</button>
    </div>
  );

  function increment() {
    setCount(count + 1);
  }

  function decrement() {
    setCount(Math.max(0, count - 1));
  }
};
