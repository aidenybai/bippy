import { useState } from "react";

const NEXT_STEP: Record<number, number> = { 0: 2, 1: 0, 2: 1 };

export const NumberKeyTable = () => {
  const [step, setStep] = useState(0);
  return (
    <button onClick={() => setStep(NEXT_STEP[step] ?? 0)}>
      {step === 2 ? "two" : step === 1 ? "one" : "zero"}
    </button>
  );
};

const ORDER = [2, 0, 1];

export const StringIndexIntoArray = () => {
  const [slot, setSlot] = useState<"0" | "1">("0");
  return (
    <button onClick={() => setSlot("1")}>
      {ORDER[slot as unknown as number] === 0 ? "zero" : "other"}
    </button>
  );
};
