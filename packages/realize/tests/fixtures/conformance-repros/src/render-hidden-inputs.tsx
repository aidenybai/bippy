import { useState } from "react";

const toLevel = (value: number) => (value === 1 ? 1 : value === 2 ? 2 : 0);

function offset(this: { base: number }, by: number) {
  return this.base + by;
}

function* countTo(limit: number) {
  for (let index = 0; index < limit; index++) yield index;
}

const sum = (...values: number[]) => values.reduce((total, value) => total + value, 0);

const makeHolder = () => ({
  inner: 0,
  set value(next: number) {
    this.inner = next + 1;
  },
});

export const BoundLevel = () => {
  const [step, setStep] = useState(0);
  const level = toLevel(offset.bind({ base: step })(1));
  return (
    <div>
      <p>{level === 2 ? "high" : "low"}</p>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const CountedLevel = () => {
  const [step, setStep] = useState(0);
  const level = toLevel([...countTo(step)].length);
  return (
    <div>
      <p>{level === 1 ? "one" : "other"}</p>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const DatedLevel = () => {
  const [step, setStep] = useState(0);
  const level = toLevel(new Date(step).getTime());
  return (
    <div>
      <p>{level === 1 ? "one" : "other"}</p>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const HolderLevel = () => {
  const [step, setStep] = useState(0);
  const holder = makeHolder();
  holder.value = step;
  const level = toLevel(holder.inner);
  return (
    <div>
      <p>{level === 2 ? "high" : "low"}</p>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const GetterLevel = () => {
  const [step, setStep] = useState(0);
  const counter = {
    base: step,
    get next() {
      return this.base + 1;
    },
  };
  const level = toLevel(counter.next);
  return (
    <div>
      <p>{level === 2 ? "high" : "low"}</p>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const SetterLevel = () => {
  const [step, setStep] = useState(0);
  const box = {
    inner: 0,
    set value(next: number) {
      this.inner = next + 1;
    },
  };
  box.value = step;
  return (
    <div>
      <p>{box.inner === 2 ? "high" : "low"}</p>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const GetterSumLevel = () => {
  const [step, setStep] = useState(0);
  const counter = {
    base: step,
    get next() {
      return this.base + 1;
    },
  };
  const level = toLevel(sum(counter.next, 1));
  return (
    <div>
      <p>{level === 2 ? "high" : "low"}</p>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};
