import { useRef, useState } from "react";

export const RefActionDirect = () => {
  const [flag, setFlag] = useState(false);
  const [count, setCount] = useState(0);
  const act = useRef(() => {
    if (flag) setCount(1);
    else setCount(2);
  }).current;
  return (
    <div>
      <button onClick={act}>act</button>
      <button onClick={() => setFlag(!flag)}>flip</button>
      {count === 2 ? <i>two</i> : count === 1 ? <i>one</i> : <i>zero</i>}
    </div>
  );
};

export const RefActionCalled = () => {
  const [flag, setFlag] = useState(false);
  const [count, setCount] = useState(0);
  const actRef = useRef(() => {
    if (flag) setCount(1);
    else setCount(2);
  });
  return (
    <div>
      <button onClick={() => actRef.current()}>act</button>
      <button onClick={() => setFlag(!flag)}>flip</button>
      {flag && count === 2 ? <i>flag two</i> : count === 2 ? <i>two</i> : <i>other</i>}
    </div>
  );
};
