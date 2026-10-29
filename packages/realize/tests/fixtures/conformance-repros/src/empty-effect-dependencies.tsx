import { useEffect, useState } from "react";

export const AssertedDependencies = () => {
  const [count, setCount] = useState(0);
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => () => setCleaned(true), [] as const);
  return (
    <div>
      {cleaned ? <b>cleaned</b> : <s>cleaned</s>}
      <button onClick={() => setCount(count + 1)}>bump</button>
    </div>
  );
};

export const CommentedDependencies = () => {
  const [count, setCount] = useState(0);
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => () => setCleaned(true), [/* once */]);
  return (
    <div>
      {cleaned ? <b>cleaned</b> : <s>cleaned</s>}
      <button onClick={() => setCount(count + 1)}>bump</button>
    </div>
  );
};

export const CountDependencies = () => {
  const [count, setCount] = useState(0);
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => () => setCleaned(true), [count]);
  return (
    <div>
      {cleaned ? <b>cleaned</b> : <s>cleaned</s>}
      <button onClick={() => setCount(count + 1)}>bump</button>
    </div>
  );
};
