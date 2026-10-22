import { useMemo, useState } from "react";

export const Remainder = () => {
  const [count, setCount] = useState(1);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>next</button>
      {count % 2 === 1 ? <i>odd</i> : <i>even</i>}
    </div>
  );
};

export const Doubled = () => {
  const [count, setCount] = useState(1);
  const doubled = useMemo(() => count * 2, [count]);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>next</button>
      {doubled === 2 ? <i>two</i> : <i>more</i>}
    </div>
  );
};
