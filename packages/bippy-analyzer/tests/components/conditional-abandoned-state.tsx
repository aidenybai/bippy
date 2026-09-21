import { Suspense, useEffect, useLayoutEffect, useState } from "react";

interface PhaseProps {
  phase: number;
}

interface UpdateValue {
  (value: number): void;
}

const shouldUpdate = Boolean(document.createElement("canvas").getContext("2d"));
const pending = new Promise<void>(() => {});
const trace: string[] = [];
let updateValue: UpdateValue | null = null;

const Pause = ({ phase }: PhaseProps) => {
  if (phase === 1) throw pending;
  return <span>ready</span>;
};

const Tail = ({ phase }: PhaseProps) => {
  const [value, setValue] = useState(0);
  useLayoutEffect(() => {
    updateValue = setValue;
    trace.push(String(value));
  }, [value]);
  if (phase === 1 && value === 0) setValue(1);
  return <span>{value}</span>;
};

export const isPartial = true;
export const isEnumerated = true;

export default () => {
  const [phase, setPhase] = useState(0);
  const [snapshot, setSnapshot] = useState("");
  useLayoutEffect(() => {
    if (phase === 0) setPhase(1);
  }, [phase]);
  useEffect(() => {
    if (phase === 1)
      setTimeout(() => {
        if (shouldUpdate) updateValue?.(5);
        setPhase(2);
      }, 0);
    if (phase === 2) setSnapshot(trace.join("|"));
  }, [phase]);
  const childPhase = phase === 2 ? 0 : phase;
  return (
    <main>
      <Suspense fallback={<i>loading</i>}>
        <Pause phase={childPhase} />
        <Tail phase={childPhase} />
      </Suspense>
      <p>
        {"trace:"}
        {snapshot}
      </p>
    </main>
  );
};
