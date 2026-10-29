import { useState } from "react";

const createHolder = (step: () => void) => ({
  step,
  run() {
    this.step();
  },
});

export const LocalThis = () => {
  const [n, setN] = useState(0);
  const holder = {
    step: () => setN(2),
    run() {
      this.step();
    },
  };
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => holder.run()}>run</button>
    </div>
  );
};

export const FactoryThis = () => {
  const [n, setN] = useState(0);
  const holder = createHolder(() => setN(2));
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => holder.run()}>run</button>
    </div>
  );
};

export const ArrowThis = () => {
  const [n, setN] = useState(0);
  const holder = {
    step: () => setN(2),
    run() {
      [0].forEach(() => this.step());
    },
  };
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => holder.run()}>run</button>
    </div>
  );
};

export const BorrowedThis = () => {
  const [n, setN] = useState(0);
  const first = {
    step: () => setN(1),
    run() {
      this.step();
    },
  };
  const second = { step: () => setN(2), run: first.run };
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => second.run()}>run</button>
    </div>
  );
};
