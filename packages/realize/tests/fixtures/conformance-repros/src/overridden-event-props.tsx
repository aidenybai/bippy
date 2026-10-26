import { useState } from "react";

export const AttributeThenSpread = () => {
  const [step, setStep] = useState(0);
  const extra = { onClick: () => setStep(2) };
  return (
    <button onClick={() => setStep(1)} {...extra}>
      {step === 0 ? "zero" : step === 1 ? "one" : "two"}
    </button>
  );
};

export const SpreadThenAttribute = () => {
  const [step, setStep] = useState(0);
  const extra = { onClick: () => setStep(2) };
  return (
    <button {...extra} onClick={() => setStep(1)}>
      {step === 0 ? "zero" : step === 1 ? "one" : "two"}
    </button>
  );
};

export const SecondSpreadWins = () => {
  const [step, setStep] = useState(0);
  const first = { onClick: () => setStep(1) };
  const second = { onClick: () => setStep(2) };
  return (
    <button {...first} {...second}>
      {step === 0 ? "zero" : step === 1 ? "one" : "two"}
    </button>
  );
};

export const SpreadClearsHandler = () => {
  const [isOn, setIsOn] = useState(false);
  const extra = { onClick: undefined };
  return (
    <button onClick={() => setIsOn(true)} {...extra}>
      {isOn ? "on" : "off"}
    </button>
  );
};
