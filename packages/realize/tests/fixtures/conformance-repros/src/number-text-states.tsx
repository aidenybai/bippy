import { useState } from "react";

export const PlusOneAfterText = () => {
  const [value, setValue] = useState<number | string>(0);
  return (
    <div>
      {value > 5 ? <b>big</b> : <s>small</s>}
      <button onClick={() => setValue(value > 3 ? 0 : (value as number) + 1)}>inc</button>
      <button onClick={() => setValue("1")}>text</button>
    </div>
  );
};

export const AnyPlusOne = () => {
  const [value, setValue] = useState<any>(0);
  return (
    <div>
      {value > 5 ? <b>big</b> : <s>small</s>}
      <button onClick={() => setValue(value > 3 ? 0 : value + 1)}>inc</button>
      <button onClick={() => setValue(JSON.parse('"1"'))}>text</button>
    </div>
  );
};
