import { useState } from "react";

export const SetterSink = () => {
  const [isOn, setIsOn] = useState(false);
  const sink = {
    set value(next: boolean) {
      setIsOn(next);
    },
  };
  return <button onClick={() => (sink.value = !isOn)}>{isOn ? "on" : "off"}</button>;
};

export const CyclingSink = () => {
  const [step, setStep] = useState(0);
  const sink = {
    set value(next: number) {
      setStep(next % 3);
    },
  };
  return <button onClick={() => (sink.value = step + 1)}>{step === 2 ? "two" : "other"}</button>;
};
