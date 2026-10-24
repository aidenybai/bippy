import { useState } from "react";

export const ThenChosen = () => {
  const [isLeft, setIsLeft] = useState(true);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  return (
    <div>
      <button onClick={() => setIsLeft(!isLeft)}>flip</button>
      <button
        onClick={() => {
          void Promise.resolve().then(isLeft ? () => setLeft(1) : () => setRight(1));
        }}
      >
        go
      </button>
      {left === 1 && right === 0 ? <i>leftonly</i> : null}
      {right === 1 && left === 0 ? <i>rightonly</i> : null}
    </div>
  );
};

export const ForEachChosen = () => {
  const [isLeft, setIsLeft] = useState(true);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  return (
    <div>
      <button onClick={() => setIsLeft(!isLeft)}>flip</button>
      <button onClick={() => [1].forEach(isLeft ? () => setLeft(1) : () => setRight(1))}>go</button>
      {left === 1 && right === 0 ? <i>leftonly</i> : null}
      {right === 1 && left === 0 ? <i>rightonly</i> : null}
    </div>
  );
};

export const MicrotaskChosen = () => {
  const [isLeft, setIsLeft] = useState(true);
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  return (
    <div>
      <button onClick={() => setIsLeft(!isLeft)}>flip</button>
      <button onClick={() => queueMicrotask(isLeft ? () => setLeft(1) : () => setRight(1))}>
        go
      </button>
      {left === 1 && right === 0 ? <i>leftonly</i> : null}
      {right === 1 && left === 0 ? <i>rightonly</i> : null}
    </div>
  );
};
