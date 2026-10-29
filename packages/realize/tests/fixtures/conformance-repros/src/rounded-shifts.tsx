import { useState } from "react";

export const AddHuge = () => {
  const [value, setValue] = useState(0.05);
  return (
    <div>
      {value < 0.1 ? <b>low</b> : <s>low</s>}
      {value >= 1e308 ? <b>huge</b> : <s>huge</s>}
      <button onClick={() => setValue(value + 1e308)}>jump</button>
      <button onClick={() => setValue(value / 3)}>third</button>
    </div>
  );
};

export const ScaleAndAdd = () => {
  const [value, setValue] = useState(0.05);
  return (
    <div>
      {value < 0.1 ? <b>low</b> : <s>low</s>}
      {value >= 1e16 ? <b>huge</b> : <s>huge</s>}
      <button onClick={() => setValue(value * 3 + 1e16)}>jump</button>
      <button onClick={() => setValue(value / 3)}>third</button>
    </div>
  );
};
