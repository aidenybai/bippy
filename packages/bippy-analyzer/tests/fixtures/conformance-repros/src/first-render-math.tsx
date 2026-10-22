import { useState } from "react";

export const MaxStep = () => {
  const [step, setStep] = useState(1);
  return (
    <div>
      <button onClick={() => setStep(step + 1)}>next</button>
      {Math.max(step - 1, 0) === 0 ? <i>start</i> : <i>later</i>}
    </div>
  );
};

export const HalfStep = () => {
  const [step, setStep] = useState(1);
  const half = Math.floor(step / 2);
  return (
    <div>
      <button onClick={() => setStep(step + 1)}>next</button>
      {half === 0 ? <i>start</i> : <i>later</i>}
    </div>
  );
};
