import { useState } from "react";

const sumTo = (limit: number) => {
  let total = 0;
  for (let index = 1; index <= limit; index++) total += index;
  return total;
};

export const LoopHelper = () => {
  const [n, setN] = useState(2);
  return (
    <button onClick={() => setN(n + 1)}>{sumTo(n) === 3 ? <i>three</i> : <i>other</i>}</button>
  );
};

export const RenderUpdatedLoop = () => {
  const [n, setN] = useState(2);
  if (n < 3) setN(3);
  return <p>{sumTo(n) === 3 ? <i>three</i> : <i>other</i>}</p>;
};
