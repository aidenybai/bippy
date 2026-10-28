import { useState } from "react";

export const FarAbove = () => {
  const [value, setValue] = useState(0);
  const [limit] = useState(1e16);
  return (
    <div>
      {value < 1 ? <b>small</b> : <s>small</s>}
      {limit >= 1e16 ? <b>limit</b> : <s>limit</s>}
      <button onClick={() => setValue(value + 0.5)}>half</button>
    </div>
  );
};

export const FarBelow = () => {
  const [value, setValue] = useState(0);
  const [limit] = useState(-1e16);
  return (
    <div>
      {value < 1 ? <b>small</b> : <s>small</s>}
      {limit > 0 ? <b>limit</b> : <s>limit</s>}
      <button onClick={() => setValue(value + 0.5)}>half</button>
    </div>
  );
};
