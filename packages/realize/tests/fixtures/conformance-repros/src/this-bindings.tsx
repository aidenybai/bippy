import { useState } from "react";

export const BoundElsewhere = () => {
  const [n, setN] = useState(0);
  const first = {
    step: () => setN(1),
    run() {
      this.step();
    },
  };
  const second = { step: () => setN(2) };
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={first.run.bind(first)}>first</button>
      <button onClick={first.run.bind(second)}>second</button>
    </div>
  );
};

export const CalledOn = () => {
  const [n, setN] = useState(0);
  const first = {
    step: () => setN(1),
    run() {
      this.step();
    },
  };
  const second = { step: () => setN(2) };
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => first.run.call(second)}>call</button>
    </div>
  );
};

export const AppliedOn = () => {
  const [n, setN] = useState(0);
  const first = {
    step: () => setN(1),
    run() {
      this.step();
    },
  };
  const second = { step: () => setN(2) };
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => first.run.apply(second, [])}>apply</button>
    </div>
  );
};

export const SetterThis = () => {
  const [n, setN] = useState(0);
  const holder = {
    step: () => setN(2),
    set value(next: number) {
      if (next === 2) this.step();
    },
  };
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button
        onClick={() => {
          holder.value = 2;
        }}
      >
        set
      </button>
    </div>
  );
};

export const ChosenBoundArguments = () => {
  const [n, setN] = useState(0);
  const [k, setK] = useState(0);
  const pick = (value: number) => setN(value);
  return (
    <div>
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={k === 0 ? pick.bind(null, 1) : pick.bind(null, 2)}>pick</button>
      <button onClick={() => setK(1 - k)}>flip</button>
    </div>
  );
};

export const ChosenBoundReceivers = () => {
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
      <button onClick={n === 0 ? first.run.bind(first) : second.run.bind(second)}>run</button>
    </div>
  );
};

export const SetterAfterMethodCall = () => {
  const [n, setN] = useState(0);
  const holder = {
    step: () => setN(1),
    run() {
      this.step();
    },
    set value(next: number) {
      if (next === 2) setN(2);
    },
  };
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n === 2 ? <b>two</b> : <s>two</s>}
      <button onClick={() => holder.run()}>run</button>
      <button
        onClick={() => {
          holder.value = 2;
        }}
      >
        set
      </button>
    </div>
  );
};
