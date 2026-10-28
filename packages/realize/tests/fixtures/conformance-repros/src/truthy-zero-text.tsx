import { useState } from "react";

export const SpaceOrOne = () => {
  const [value, setValue] = useState("a");
  return (
    <div>
      {value == 0 ? <b>zero</b> : <s>zero</s>}
      {(value || 1) === 1 ? <b>falsy</b> : <s>falsy</s>}
      <button onClick={() => setValue(" ")}>space</button>
      <button onClick={() => setValue(`${value}`.trim())}>trim</button>
    </div>
  );
};

export const SpaceNotNot = () => {
  const [value, setValue] = useState<string | number | null>(" ");
  return (
    <div>
      {value == 0 ? <b>zero</b> : <s>zero</s>}
      {!!value === true ? <b>truthy</b> : <s>truthy</s>}
      <button onClick={() => setValue(`${value}`.trim())}>trim</button>
      <button onClick={() => setValue(value || 0)}>or</button>
    </div>
  );
};
