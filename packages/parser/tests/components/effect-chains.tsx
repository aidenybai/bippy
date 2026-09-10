import { useEffect, useState } from "react";

const STEP_DURATION_MS = 25;

const CountUp = ({ value, duration = 500 }: { value: number; duration?: number }) => {
  const [shown, setShown] = useState(0);
  const timeoutIds: ReturnType<typeof setTimeout>[] = [];
  const grow = (increment: number) => {
    const next = Math.ceil(shown + increment);
    if (next > value) {
      setShown(value);
      return;
    }
    setShown(next);
    timeoutIds.push(setTimeout(() => grow(increment), STEP_DURATION_MS));
  };
  useEffect(() => {
    grow(value / (duration / STEP_DURATION_MS));
    return () => {
      timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
    };
  });
  return <output>{shown < 1000 ? shown : shown.toLocaleString("en-US")}</output>;
};

const Ladder = ({ steps }: { steps: number }) => {
  const [rung, setRung] = useState(0);
  useEffect(() => {
    if (rung < steps) setRung(rung + 1);
  }, [rung, steps]);
  return (
    <ul>
      {Array.from({ length: rung }, (_, index) => (
        <li key={index}>{index}</li>
      ))}
    </ul>
  );
};

export const isExact = true;

export default function EffectChains() {
  return (
    <div>
      <CountUp value={256} />
      <CountUp value={7770} />
      <CountUp value={12} duration={100} />
      <Ladder steps={30} />
    </div>
  );
}
