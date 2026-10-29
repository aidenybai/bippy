import { useState } from "react";

export const CapturedStepLabel = () => {
  const [step, setStep] = useState(0);
  let label = "start";
  if (step === 1) label = "middle";
  if (step === 2) label = "end";
  const describe = () => label;
  return (
    <button onClick={() => setStep(Math.min(step + 1, 2))} onMouseEnter={describe}>
      {label === "start" ? "start" : label === "middle" ? "middle" : "end"}
    </button>
  );
};

export const CapturedNextStep = () => {
  const [step, setStep] = useState(0);
  let next = 1;
  const advance = () => setStep(next);
  if (step === 1) next = 2;
  return <button onClick={advance}>{step === 0 ? "zero" : step === 1 ? "one" : "two"}</button>;
};

export const CapturedSwitchLabel = () => {
  const [count, setCount] = useState(0);
  let label = "unset";
  const describe = () => label;
  switch (count) {
    case 0:
      label = "empty";
      break;
    case 1:
      label = "single";
      break;
  }
  return (
    <button onClick={() => setCount(count + 1)} onMouseEnter={describe}>
      {label === "single" ? "one" : "other"}
    </button>
  );
};

export const CapturedReturnArm = () => {
  const [step, setStep] = useState(0);
  let next = 1;
  const advance = () => setStep(next);
  if (step === 2) {
    next = 0;
    return <button onClick={advance}>two</button>;
  }
  if (step === 1) next = 2;
  return <button onClick={advance}>{step === 0 ? "zero" : "one"}</button>;
};

export const CapturedReturnCase = () => {
  const [step, setStep] = useState(0);
  let next = 1;
  const advance = () => setStep(next);
  switch (step) {
    case 2:
      next = 0;
      return <button onClick={advance}>two</button>;
    case 1:
      next = 2;
      break;
  }
  return <button onClick={advance}>{step === 0 ? "zero" : "one"}</button>;
};

export const CapturedTryCatch = () => {
  const [step, setStep] = useState(0);
  let next = 1;
  const advance = () => setStep(next);
  try {
    if (step === 1) next = 2;
  } catch {
    next = 0;
  }
  return <button onClick={advance}>{step === 0 ? "zero" : step === 1 ? "one" : "two"}</button>;
};
