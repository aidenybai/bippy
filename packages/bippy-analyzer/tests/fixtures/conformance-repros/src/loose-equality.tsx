import { useState } from "react";

export const TrueEqOne = () => {
  const [value] = useState<boolean>(true);
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button onClick={() => setTick(tick + 1)}>go</button>
      {value == 1 ? <i>true</i> : <i>false</i>}
    </div>
  );
};

export const StringEqNumber = () => {
  const [value, setValue] = useState("1");
  return (
    <div>
      <button onClick={() => setValue("")}>clear</button>
      {value == 1 ? <i>one</i> : value == 0 ? <i>zero</i> : <i>other</i>}
    </div>
  );
};

export const FalseNeOne = () => {
  const [value, setValue] = useState(false);
  return (
    <div>
      <button onClick={() => setValue(true)}>on</button>
      {value != 1 ? <i>off</i> : <i>on</i>}
    </div>
  );
};

export const BooleanEqOne = () => {
  const [value, setValue] = useState<boolean>(false);
  return (
    <div>
      <button onClick={() => setValue(!value)}>flip</button>
      {value == 1 ? <i>on</i> : <i>off</i>}
    </div>
  );
};
