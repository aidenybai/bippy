import { useState } from "react";

export const DoubledCount = () => {
  const [count, setCount] = useState(1);
  return (
    <div>
      <button onClick={() => setCount(count * 2)}>double</button>
      <button onClick={() => setCount(0)}>clear</button>
      {count > 0 ? <i>some</i> : <i>none</i>}
    </div>
  );
};

export const HalvedCount = () => {
  const [count, setCount] = useState(-8);
  return (
    <div>
      <button onClick={() => setCount(count / 2)}>halve</button>
      <button onClick={() => setCount(1)}>flip</button>
      {count < 0 ? <i>negative</i> : <i>positive</i>}
    </div>
  );
};

export const HalvedToZero = () => {
  const [count, setCount] = useState(1);
  return (
    <div>
      <button onClick={() => setCount(count / 2)}>halve</button>
      {count > 0 ? <i>above</i> : <i>zero</i>}
      {count >= 1 ? <b>whole</b> : <b>part</b>}
    </div>
  );
};
