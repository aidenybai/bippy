import { useState } from "react";

export const PlainCall = () => {
  const [left, setLeft] = useState(0);
  const onLeft = () => setLeft(1);
  return (
    <div>
      <button onClick={() => onLeft.call(null)}>go</button>
      {left === 1 ? <i>leftonly</i> : null}
    </div>
  );
};

export const PlainApply = () => {
  const [pick, setPick] = useState("a");
  const choose = (value: string) => setPick(value);
  return (
    <div>
      <button onClick={() => choose.apply(null, ["b"])}>go</button>
      {pick === "b" ? <i>L2</i> : <i>L1</i>}
    </div>
  );
};

export const ChosenCall = () => {
  const [isLeft, setIsLeft] = useState(true);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const onLeft = () => setLeft(1);
  const onRight = () => setRight(1);
  return (
    <div>
      <button onClick={() => setIsLeft(!isLeft)}>flip</button>
      <button onClick={() => (isLeft ? onLeft : onRight).call(null)}>go</button>
      {left === 1 && right === 0 ? <i>leftonly</i> : null}
      {right === 1 && left === 0 ? <i>rightonly</i> : null}
    </div>
  );
};
