import { useState } from "react";

export const SumEquals = () => {
  const [value, setValue] = useState(-0.9);
  return (
    <div>
      {value <= -0.9 ? <b>start</b> : <s>start</s>}
      {value + 0.2 === -0.7 ? <b>sum</b> : <s>sum</s>}
      <button onClick={() => setValue(value / 3)}>third</button>
      <button onClick={() => setValue(-0.9)}>reset</button>
    </div>
  );
};

export const SumAbove = () => {
  const [value, setValue] = useState(-1);
  return (
    <div>
      {value <= -1 ? <b>start</b> : <s>start</s>}
      {value + 0.8 > -0.2 ? <b>sum</b> : <s>sum</s>}
      <button onClick={() => setValue(value / 3)}>third</button>
      <button onClick={() => setValue(-1)}>reset</button>
    </div>
  );
};
