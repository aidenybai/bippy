import { useState } from "react";

export const LengthFieldDown = () => {
  const [value, setValue] = useState({ length: 1 });
  return (
    <div>
      {value.length < 0 ? <b>negative</b> : <s>negative</s>}
      <button onClick={() => setValue({ length: value.length - 2 })}>down</button>
    </div>
  );
};

interface Span {
  length: number;
  label: string;
}

export const SpanBelowZero = () => {
  const [span, setSpan] = useState<Span>({ length: 0, label: "start" });
  return (
    <div>
      {span.length >= 0 ? <b>forward</b> : <s>forward</s>}
      <button onClick={() => setSpan({ length: -1, label: "back" })}>back</button>
    </div>
  );
};

export const ListNeverNegative = () => {
  const [items, setItems] = useState<number[]>([]);
  return (
    <div>
      {items.length < 0 ? <b>negative</b> : <s>negative</s>}
      <button onClick={() => setItems([...items, 1])}>add</button>
    </div>
  );
};
