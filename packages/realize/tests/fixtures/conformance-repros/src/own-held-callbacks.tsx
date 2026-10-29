import { useMemo, useReducer, useState } from "react";

export const StaleMemoObject = () => {
  const [n, setN] = useState(0);
  const handlers = useMemo(() => ({ run: () => setN(n + 1) }), []);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <button onClick={handlers.run}>step</button>
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const FreshMemoObject = () => {
  const [n, setN] = useState(0);
  const handlers = useMemo(() => ({ run: () => setN(n + 1) }), [n]);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <button onClick={handlers.run}>step</button>
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const ReducerHeld = () => {
  const [n, setN] = useState(0);
  const [first] = useReducer(
    (current: () => void) => current,
    () => setN(n + 1),
  );
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <button onClick={first}>step</button>
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};
