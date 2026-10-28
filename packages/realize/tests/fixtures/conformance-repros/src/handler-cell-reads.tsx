import { useRef, useState } from "react";

export const CapturedOrAssign = () => {
  const [step, setStep] = useState(2);
  return (
    <div>
      {step === 0 ? <i>zero</i> : step === 1 ? <i>one</i> : <i>two</i>}
      <button
        onClick={() => {
          let next = step;
          const peek = () => next;
          next = peek() === 1 ? 0 : 2;
          next ||= step + 1;
          setStep(next === 1 ? 1 : next === 2 ? 2 : 0);
        }}
      >
        fill
      </button>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const CapturedIfAssign = () => {
  const [step, setStep] = useState(2);
  return (
    <div>
      {step === 0 ? <i>zero</i> : step === 1 ? <i>one</i> : <i>two</i>}
      <button
        onClick={() => {
          let next = step;
          const peek = () => next;
          next = peek() === 1 ? 0 : 2;
          if (!next) next = step + 1;
          setStep(next === 1 ? 1 : next === 2 ? 2 : 0);
        }}
      >
        fill
      </button>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const ClosureBranchWrite = () => {
  const [step, setStep] = useState(2);
  return (
    <div>
      {step === 0 ? <i>zero</i> : step === 1 ? <i>one</i> : <i>two</i>}
      <button
        onClick={() => {
          let next = 0;
          const choose = (value: number) => {
            next = value;
          };
          if (step !== 0) choose(step === 1 ? 2 : 1);
          setStep(step > 5 ? 0 : next);
        }}
      >
        fill
      </button>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};

export const RefBranchWrite = () => {
  const [step, setStep] = useState(2);
  const pending = useRef(0);
  return (
    <div>
      {step === 0 ? <i>zero</i> : step === 1 ? <i>one</i> : <i>two</i>}
      <button
        onClick={() => {
          pending.current = step === 1 ? 0 : 1;
          if (!pending.current) pending.current = step + 1;
          let next = 0;
          if (step >= 0) next = pending.current;
          setStep(next === 1 ? 1 : next === 2 ? 2 : 0);
        }}
      >
        fill
      </button>
      <button onClick={() => setStep(step === 0 ? 1 : step === 1 ? 2 : 0)}>cycle</button>
    </div>
  );
};
