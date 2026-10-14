import { useState } from "react";

export const CopySteps = ({ steps }) => {
  const [copiedStep, setCopiedStep] = useState(null);
  return (
    <div>
      {steps.map((step, index) => (
        <button type="button" key={step} onClick={() => setCopiedStep(index)}>
          {copiedStep === index ? "Copied" : step}
        </button>
      ))}
    </div>
  );
};
