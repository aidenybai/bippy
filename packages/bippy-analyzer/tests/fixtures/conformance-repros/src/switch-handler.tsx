import { useState } from "react";

type Reason = "too_expensive" | "missing_features" | "other";

const REASONS: Array<{ value: Reason; label: string }> = [
  { value: "too_expensive", label: "It's too expensive" },
  { value: "missing_features", label: "Some features are missing" },
  { value: "other", label: "Other reason" },
];

export const CancellationReasons = () => {
  const [step, setStep] = useState<"reason" | "offer" | "call" | "feedback">("reason");
  const handleReasonClick = (reason: Reason) => {
    switch (reason) {
      case "too_expensive":
        setStep("offer");
        break;
      case "missing_features":
        setStep("call");
        break;
      default:
        setStep("feedback");
    }
  };
  if (step === "offer") return <p>Here is a discount</p>;
  if (step === "call") return <p>Let's schedule a call</p>;
  if (step === "feedback") return <p>Tell us more</p>;
  return (
    <div>
      {REASONS.map((reason) => (
        <button key={reason.value} type="button" onClick={() => handleReasonClick(reason.value)}>
          {reason.label}
        </button>
      ))}
    </div>
  );
};
