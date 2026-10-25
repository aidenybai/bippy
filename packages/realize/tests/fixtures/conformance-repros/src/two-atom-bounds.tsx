import { useState } from "react";

export const ToggledPair = () => {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  return (
    <button
      onClick={() => {
        setX(x === 0 ? 2 : 0);
        setY(y === 0 ? 1 : 0);
      }}
    >
      {y - x >= -2 ? "pair" : "never"}
      {x + 1 !== 2 ? "offset" : "never"}
    </button>
  );
};

export const RangeWindow = () => {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(3);
  return (
    <div>
      <button onClick={() => setEnd(end + 1)}>grow</button>
      <button onClick={() => setStart(start - 1)}>shift</button>
      {end - start > 0 ? <i>open</i> : <i>empty</i>}
    </div>
  );
};
