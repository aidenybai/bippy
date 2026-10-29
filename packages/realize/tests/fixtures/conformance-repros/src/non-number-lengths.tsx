import { useState } from "react";

export const ArrayOrNumber = () => {
  const [value, setValue] = useState<string[] | number>([]);
  return (
    <div>
      {value instanceof Array ? <i>list</i> : <i>number</i>}
      {(value as string[]).length > 2 ? <b>long</b> : <s>long</s>}
      {(value as string[]).length <= 2 ? <b>short</b> : <s>short</s>}
      <button onClick={() => setValue(5)}>number</button>
      <button onClick={() => setValue(["a", "b", "c"])}>three</button>
    </div>
  );
};

export const AnyLength = () => {
  const [value, setValue] = useState<any>("ab");
  return (
    <div>
      {value.length > 1 ? <b>long</b> : <s>long</s>}
      {value.length < 2 ? <b>short</b> : <s>short</s>}
      {value.length === undefined ? <b>none</b> : <s>none</s>}
      <button onClick={() => setValue({})}>object</button>
      <button onClick={() => setValue("")}>empty</button>
    </div>
  );
};

export const ObjectWithLength = () => {
  const [value, setValue] = useState<{ length?: number | string }>({ length: 3 });
  return (
    <div>
      {(value.length as number) > 2 ? <b>long</b> : <s>long</s>}
      {(value.length as number) <= 2 ? <b>short</b> : <s>short</s>}
      <button onClick={() => setValue({})}>empty</button>
      <button onClick={() => setValue({ length: "x" })}>text</button>
    </div>
  );
};

export const ListSetNumber = () => {
  const [value, setValue] = useState<number[] | number>([1, 2]);
  return (
    <div>
      {(value as number[]).length > 1 ? <b>long</b> : <s>long</s>}
      {(value as number[]).length <= 1 ? <b>short</b> : <s>short</s>}
      <button onClick={() => setValue(7)}>seven</button>
      <button onClick={() => setValue([1])}>one</button>
    </div>
  );
};
