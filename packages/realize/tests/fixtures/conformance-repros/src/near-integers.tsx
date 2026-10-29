import { useState } from "react";

export const PlusOne = () => {
  const [value, setValue] = useState(3);
  return (
    <div>
      {value > 3 ? <b>above</b> : <s>above</s>}
      {value + 1 > 4 ? <b>sum</b> : <s>sum</s>}
      <button onClick={() => setValue(value + 1)}>step</button>
      <button onClick={() => setValue(value + 4e-16)}>nudge</button>
    </div>
  );
};

export const FromEight = () => {
  const [value, setValue] = useState(3);
  return (
    <div>
      {value > 3 ? <b>above</b> : <s>above</s>}
      {8 - value < 5 ? <b>gap</b> : <s>gap</s>}
      <button onClick={() => setValue(value + 1)}>step</button>
      <button onClick={() => setValue(value + 4e-16)}>nudge</button>
    </div>
  );
};

export const DifferenceAtOne = () => {
  const [x] = useState(1);
  const [y, setY] = useState(0);
  return (
    <div>
      {y > 0 ? <b>moved</b> : <s>moved</s>}
      {x - y >= 1 ? <b>ahead</b> : <s>ahead</s>}
      <button onClick={() => setY(y + 1e-17)}>nudge</button>
    </div>
  );
};
