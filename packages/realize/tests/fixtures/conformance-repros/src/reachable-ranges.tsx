import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <div>
      <button onClick={() => setCount(count + 1)}>up</button>
      {count < 0 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const ClampedPager = () => {
  const [page, setPage] = useState(0);
  return (
    <div>
      <button onClick={() => setPage(Math.max(page - 1, 0))}>prev</button>
      <button onClick={() => setPage(Math.min(page + 1, 2))}>next</button>
      {page === 0 ? <i>L1</i> : page === 1 ? <i>L2</i> : page === 2 ? <i>L3</i> : null}
    </div>
  );
};

export const GuardedPager = () => {
  const [page, setPage] = useState(0);
  return (
    <div>
      <button
        onClick={() => {
          if (page > 0) setPage(page - 1);
        }}
      >
        prev
      </button>
      <button
        onClick={() => {
          if (page < 2) setPage(page + 1);
        }}
      >
        next
      </button>
      {page === 0 ? <i>L1</i> : page === 1 ? <i>L2</i> : page === 2 ? <i>L3</i> : null}
    </div>
  );
};

export const ConditionalStep = () => {
  const [step, setStep] = useState(0);
  return (
    <div>
      <button onClick={() => setStep(step < 2 ? step + 1 : step)}>go</button>
      {step === 3 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const RenderedPager = () => {
  const [page, setPage] = useState(0);
  return (
    <div>
      {page > 0 && <button onClick={() => setPage(page - 1)}>prev</button>}
      {page < 2 && <button onClick={() => setPage(page + 1)}>next</button>}
      {page === 0 ? <i>L1</i> : page === 1 ? <i>L2</i> : page === 2 ? <i>L3</i> : null}
    </div>
  );
};

export const WizardSteps = () => {
  const [index, setIndex] = useState(0);
  const isLast = index === 2;
  return (
    <div>
      {isLast ? <i>finish</i> : <button onClick={() => setIndex(index + 1)}>next</button>}
      {index === 0 ? <i>L1</i> : index === 1 ? <i>L2</i> : index === 2 ? <i>L3</i> : null}
    </div>
  );
};
