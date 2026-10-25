import { useState } from "react";

export const EvenToggle = () => {
  const [x, setX] = useState(0);
  return (
    <button onClick={() => setX(x === 0 ? 2 : 0)}>
      {x % 2 === 0 ? "even" : "never"}
      {x * 3 !== 3 ? "scaled" : "never"}
      {(x & 1) === 0 ? "masked" : "never"}
      {x >> 1 <= 1 ? "shifted" : "never"}
    </button>
  );
};

export const OddPick = () => {
  const [x, setX] = useState(1);
  return (
    <div>
      <button onClick={() => setX(x === 1 ? 2 : 1)}>next</button>
      {x % 2 === 1 ? <i>odd</i> : <i>even</i>}
      {x === 2 ? <b>two</b> : null}
    </div>
  );
};
