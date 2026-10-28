import { useState } from "react";

export const BooleanBetween = () => {
  const [value, setValue] = useState<number | boolean>(false);
  return (
    <div>
      {(value as number) >= 1 ? <b>low</b> : <s>low</s>}
      {(value as number) <= 1 ? <b>high</b> : <s>high</s>}
      {value === 1 ? <b>one</b> : <s>one</s>}
      <button onClick={() => setValue(true)}>true</button>
      <button onClick={() => setValue(1)}>one</button>
    </div>
  );
};

export const NullBetween = () => {
  const [value, setValue] = useState<number | null>(5);
  return (
    <div>
      {(value as number) >= 0 ? <b>low</b> : <s>low</s>}
      {(value as number) <= 0 ? <b>high</b> : <s>high</s>}
      {value == 0 ? <b>zero</b> : <s>zero</s>}
      <button onClick={() => setValue(null)}>null</button>
      <button onClick={() => setValue(0)}>zero</button>
    </div>
  );
};

export const TextPlusOneAbove = () => {
  const [value, setValue] = useState<number | string>(0);
  return (
    <div>
      {(value as number) < 3 ? <b>small</b> : <s>small</s>}
      {(value as number) + 1 > 5 ? <b>big</b> : <s>big</s>}
      <button onClick={() => setValue("1")}>text</button>
      <button onClick={() => setValue(2)}>two</button>
    </div>
  );
};

export const LooseThenSum = () => {
  const [value, setValue] = useState<number | string>("");
  return (
    <div>
      {value == 1 ? <b>loose</b> : <s>loose</s>}
      {(value as number) + 1 === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => setValue(Number(value) + 1)}>add</button>
      <button onClick={() => setValue(`${value}`)}>text</button>
    </div>
  );
};
