import { useState } from "react";

export const AmountInput = () => {
  const [text, setText] = useState("");
  const amount = Number(text);
  return (
    <div>
      <button onClick={() => setText("abc")}>typo</button>
      <button onClick={() => setText("5")}>five</button>
      {amount < 1 ? <i>low</i> : amount >= 1 ? <i>ok</i> : <i>not a number</i>}
    </div>
  );
};

export const ParsedInput = () => {
  const [text, setText] = useState("");
  const amount = parseInt(text, 10);
  return (
    <div>
      <button onClick={() => setText("abc")}>typo</button>
      <button onClick={() => setText("5")}>five</button>
      {amount <= 0 ? <i>low</i> : amount > 0 ? <i>ok</i> : <i>not a number</i>}
    </div>
  );
};

export const CountedSteps = () => {
  const [step, setStep] = useState(0);
  return (
    <div>
      <button onClick={() => setStep(step + 1)}>next</button>
      {step < 1 ? <i>first</i> : step >= 1 ? <i>later</i> : <i>never</i>}
    </div>
  );
};

export const ListedSteps = ({ items }: { items: string[] }) => {
  const [index, setIndex] = useState(0);
  return (
    <div>
      <button onClick={() => setIndex(index + 1)}>next</button>
      {index < items.length - 1 ? (
        <i>more</i>
      ) : index >= items.length - 1 ? (
        <i>last</i>
      ) : (
        <i>never</i>
      )}
    </div>
  );
};
