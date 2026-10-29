import { useState } from "react";

export const PointerRatio = () => {
  const [ratio, setRatio] = useState(0);
  return (
    <div onPointerMove={(event) => setRatio(Math.min(Math.max(event.clientX / 100, 0), 1))}>
      {ratio === 0 ? "start" : ratio === 1 ? "end" : "between"}
    </div>
  );
};

export const SteppedRatio = () => {
  const [step, setStep] = useState(0);
  return (
    <button onClick={() => setStep(Math.min(Math.max(step + 1, 0), 2))}>
      {step === 0 ? "start" : step === 1 ? "middle" : step === 2 ? "end" : "beyond"}
    </button>
  );
};
