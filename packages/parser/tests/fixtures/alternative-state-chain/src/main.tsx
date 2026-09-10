import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const STEP_COUNT = 3;

const Stepper = () => {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (step < STEP_COUNT) setStep((current) => current + 1);
  }, [step]);
  return step === STEP_COUNT ? <output>done</output> : <progress value={step} max={STEP_COUNT} />;
};

const App = () =>
  window.innerWidth < 0 ? (
    <nav>
      <Stepper />
    </nav>
  ) : (
    <main>
      <Stepper />
    </main>
  );

createRoot(document.getElementById("root")!).render(<App />);
