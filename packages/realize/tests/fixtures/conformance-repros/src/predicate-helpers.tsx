import { useState } from "react";

const isDone = (step: number) => step >= 3;

const getLabel = (isOn: boolean) => (isOn ? "on" : "off");

export const PredicateSteps = () => {
  const [step, setStep] = useState(0);
  return <button onClick={() => setStep(step + 1)}>{isDone(step) ? "done" : "going"}</button>;
};

export const LabelToggle = () => {
  const [isOn, setIsOn] = useState(false);
  return <button onClick={() => setIsOn(!isOn)}>{getLabel(isOn) === "on" ? "lit" : "dark"}</button>;
};
