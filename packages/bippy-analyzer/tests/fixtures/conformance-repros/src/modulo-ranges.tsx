import { useState } from "react";

export const CycleThree = () => {
  const [step, setStep] = useState(0);
  return (
    <div>
      <button onClick={() => setStep((step + 1) % 3)}>next</button>
      {step >= 3 ? <i>beyond</i> : step === 2 ? <i>last</i> : <i>early</i>}
    </div>
  );
};

export const CycleThreeUpdater = () => {
  const [step, setStep] = useState(0);
  return (
    <div>
      <button onClick={() => setStep((value) => (value + 1) % 3)}>next</button>
      {step >= 3 ? <i>beyond</i> : step === 2 ? <i>last</i> : <i>early</i>}
    </div>
  );
};
