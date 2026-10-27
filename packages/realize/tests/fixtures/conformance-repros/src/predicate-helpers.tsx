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

const MESSAGES: Record<string, string> = { save: "Save", open: "Open" };

const findMessage = (key: string) => {
  for (const name in MESSAGES) if (name === key) return MESSAGES[name];
  return undefined;
};

const label = (key: string) => {
  const message = findMessage(key);
  return message == null ? key : message;
};

export const ManyLabels = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <p>{label("save")}</p>
      <p>{label("open")}</p>
      <p>{label("close")}</p>
      <p>{label("edit")}</p>
      <p>{label("copy")}</p>
      <p>{label("paste")}</p>
      <p>{label("undo")}</p>
      <p>{label("redo")}</p>
      <button onClick={() => setIsOpen(!isOpen)}>{isOpen ? "hide" : "show"}</button>
    </div>
  );
};
