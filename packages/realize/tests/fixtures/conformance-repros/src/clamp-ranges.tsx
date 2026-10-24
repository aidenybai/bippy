import { useState } from "react";

export const ClampedStep = () => {
  const [step, setStep] = useState(0);
  return (
    <div>
      <button onClick={() => setStep((current) => Math.min(current + 1, 2))}>go</button>
      {step === 3 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const ClampedFloor = () => {
  const [step, setStep] = useState(0);
  return (
    <div>
      <button onClick={() => setStep(Math.max(step - 1, 0))}>back</button>
      {step < 0 ? <i>yes</i> : <i>no</i>}
    </div>
  );
};

export const ClampedSpan = ({ count }: { count: number }) => {
  const span = Math.min(count, 5);
  return span > 5 ? <i>never</i> : span === 5 ? <i>full</i> : <i>partial</i>;
};
