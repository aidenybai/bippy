import { useState } from "react";

export const SpreadVariable = () => {
  const [isLeft, setIsLeft] = useState(true);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const goProps = isLeft ? { onClick: () => setLeft(1) } : { onClick: () => setRight(1) };
  return (
    <div>
      <button onClick={() => setIsLeft(!isLeft)}>flip</button>
      <button {...goProps}>go</button>
      {left === 1 && right === 0 ? <i>leftonly</i> : null}
      {right === 1 && left === 0 ? <i>rightonly</i> : null}
    </div>
  );
};

export const SpreadInline = () => {
  const [isLeft, setIsLeft] = useState(true);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  return (
    <div>
      <button onClick={() => setIsLeft(!isLeft)}>flip</button>
      <button {...(isLeft ? { onClick: () => setLeft(1) } : { onClick: () => setRight(1) })}>
        go
      </button>
      {left === 1 && right === 0 ? <i>leftonly</i> : null}
      {right === 1 && left === 0 ? <i>rightonly</i> : null}
    </div>
  );
};

export const SpreadOneArm = () => {
  const [isOn, setIsOn] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setIsOn(!isOn)}>arm</button>
      <button {...(isOn ? { onClick: () => setCount(count + 1) } : {})}>go</button>
      {count > 0 ? <i>counted</i> : null}
    </div>
  );
};
