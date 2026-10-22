import { useState } from "react";

export const PushSameValue = () => {
  const [isOn, setIsOn] = useState(false);
  const [count, setCount] = useState(2);
  const [items] = useState<number[]>([1]);
  return (
    <div>
      <button
        onClick={() => {
          items.push(1);
          setCount(2);
        }}
      >
        push
      </button>
      <button onClick={() => setIsOn(!isOn)}>flip</button>
      <button onClick={() => setCount(count === 2 ? 0 : 2)}>swap</button>
      {items.length > 1 ? <i>many</i> : <i>one</i>}
      {count === 2 ? <i>two</i> : null}
      {isOn ? <i>on</i> : null}
    </div>
  );
};
