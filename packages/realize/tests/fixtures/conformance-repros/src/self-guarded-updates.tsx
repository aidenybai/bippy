import { useState } from "react";

export const GuardedReset = () => {
  const [n, setN] = useState(1);
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => {
          if (n === 3) setN(0);
        }}
      >
        reset
      </button>
      <button onClick={() => setIsOpen(!isOpen)}>toggle</button>
      {isOpen ? <i>open</i> : n === 0 ? <i>zero</i> : <i>one</i>}
    </div>
  );
};
