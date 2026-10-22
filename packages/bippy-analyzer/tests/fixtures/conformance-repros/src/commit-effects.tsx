import { useEffect, useState } from "react";

export const EffectsOfOneCommit = () => {
  const [flag, setFlag] = useState(false);
  const [count, setCount] = useState(2);
  useEffect(() => {
    if (!flag) setCount(2);
  }, [count]);
  useEffect(() => {
    if (count === 1) setFlag(true);
  }, [flag, count]);
  return (
    <div>
      <button onClick={() => setCount(1)}>one</button>
      {flag ? (
        count === 1 ? (
          <i>flag one</i>
        ) : (
          <i>flag two</i>
        )
      ) : count === 1 ? (
        <i>one</i>
      ) : (
        <i>two</i>
      )}
    </div>
  );
};
