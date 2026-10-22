import { useState } from "react";

export const MaxStep = () => {
  const [step, setStep] = useState(1);
  return (
    <div>
      <button onClick={() => setStep(step + 1)}>next</button>
      {Math.max(step - 1, 0) === 0 ? <i>start</i> : <i>later</i>}
    </div>
  );
};

export const HalfStep = () => {
  const [step, setStep] = useState(1);
  const half = Math.floor(step / 2);
  return (
    <div>
      <button onClick={() => setStep(step + 1)}>next</button>
      {half === 0 ? <i>start</i> : <i>later</i>}
    </div>
  );
};

export const ParsedChoice = () => {
  const [raw, setRaw] = useState<"1" | "2">("1");
  return (
    <div>
      <button onClick={() => setRaw(raw === "1" ? "2" : "1")}>swap</button>
      {Number(raw) > 2 ? <i>big</i> : Number(raw) > 1 ? <i>two</i> : <i>one</i>}
    </div>
  );
};

export const ParsedUnion = () => {
  const [raw, setRaw] = useState<"0" | "1">("0");
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setRaw(raw === "0" ? "1" : "0")}>swap</button>
      <button onClick={() => setCount(Number(raw))}>apply</button>
      {count === 2 ? <i>two</i> : count === 1 ? <i>one</i> : <i>none</i>}
    </div>
  );
};

export const ListedStep = () => {
  const [step, setStep] = useState(1);
  return (
    <div>
      <button onClick={() => setStep(step + 1)}>next</button>
      {[1, 2].includes(step) ? <i>early</i> : <i>late</i>}
    </div>
  );
};
