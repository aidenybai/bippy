import { useState } from "react";

type Step = "intro" | "offer" | "reason";

export const GroupedBack = () => {
  const [step, setStep] = useState<Step>("intro");
  const goBack = () => {
    switch (step) {
      case "intro":
        setStep("reason");
        break;
      case "offer":
      case "reason":
        setStep("intro");
        break;
    }
  };
  return (
    <div>
      <p>{step === "intro" ? "intro" : step === "offer" ? "offer" : "reason"}</p>
      <button onClick={goBack}>back</button>
      <button onClick={() => setStep("offer")}>offer</button>
    </div>
  );
};

export const FallingCount = () => {
  const [count, setCount] = useState(0);
  const step = () => {
    switch (count) {
      case 0:
        setCount(1);
      case 1:
        setCount(2);
        break;
      default:
        setCount(0);
    }
  };
  return <button onClick={step}>{count === 0 ? "zero" : count === 1 ? "one" : "many"}</button>;
};
