import { useReducer, useState } from "react";

type Step = "idle" | "first" | "second" | "wrong";

export const ChainedUpdaters = () => {
  const [step, setStep] = useState<Step>("idle");
  return (
    <button
      onClick={() => {
        setStep((current) => (current === "idle" ? "first" : "wrong"));
        setStep((current) => (current === "first" ? "second" : "wrong"));
      }}
    >
      {step === "idle" ? <i>idle</i> : step === "second" ? <i>second</i> : <i>other</i>}
    </button>
  );
};

export const ChainedDispatches = () => {
  const [step, dispatch] = useReducer(
    (current: Step, next: Step) =>
      next === "first"
        ? current === "idle"
          ? "first"
          : "wrong"
        : current === "first"
          ? "second"
          : "wrong",
    "idle",
  );
  return (
    <button
      onClick={() => {
        dispatch("first");
        dispatch("second");
      }}
    >
      {step === "idle" ? <i>idle</i> : step === "second" ? <i>second</i> : <i>other</i>}
    </button>
  );
};

export const ValueThenUpdater = () => {
  const [step, setStep] = useState<Step>("idle");
  return (
    <button
      onClick={() => {
        setStep("first");
        setStep((current) => (current === "first" ? "second" : "wrong"));
      }}
    >
      {step === "idle" ? <i>idle</i> : step === "second" ? <i>second</i> : <i>other</i>}
    </button>
  );
};

export const GuardedThenUpdater = ({ isQuick }: { isQuick: boolean }) => {
  const [step, setStep] = useState<Step>("idle");
  return (
    <button
      onClick={() => {
        if (isQuick) setStep("first");
        setStep((current) => (current === "first" ? "second" : "wrong"));
      }}
    >
      {step === "idle" ? <i>idle</i> : step === "second" ? <i>second</i> : <i>other</i>}
    </button>
  );
};
