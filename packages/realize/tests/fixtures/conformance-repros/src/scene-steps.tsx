import { useEffect, useState } from "react";

export const Walkthrough = () => {
  const [step, setStep] = useState(0);
  const [isHighlighted, setHighlighted] = useState(false);
  useEffect(() => {
    const scene = [
      { ms: 500, run: () => setHighlighted(true) },
      { ms: 800, run: () => setHighlighted(false) },
    ];
    const id = setTimeout(() => {
      scene[step].run();
      setStep((step + 1) % scene.length);
    }, scene[step].ms);
    return () => clearTimeout(id);
  }, [step]);
  return <p className={isHighlighted ? "glow" : undefined}>Step {step}</p>;
};
