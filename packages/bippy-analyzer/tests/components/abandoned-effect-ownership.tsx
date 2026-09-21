import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";

interface PhaseProps {
  phase: number;
}

interface ChildProps extends PhaseProps {
  isNested: boolean;
}

interface MemoValue {
  phase: number;
}

let committedMemo: MemoValue | null = null;
const trace: string[] = [];
const pending = new Promise<void>(() => {});

const Pause = ({ phase }: PhaseProps) => {
  if (phase === 1) throw pending;
  return <span>ready</span>;
};

const Child = ({ phase, isNested }: ChildProps) => {
  const label = isNested ? "nested" : "direct";
  useLayoutEffect(() => {
    trace.push(`${label}:layout:${phase}`);
    return () => {
      trace.push(`${label}:layout-clean:${phase}`);
    };
  }, [phase]);
  useEffect(() => {
    trace.push(`${label}:passive:${phase}`);
    return () => {
      trace.push(`${label}:passive-clean:${phase}`);
    };
  }, [phase]);
  if (!isNested && phase === 1) throw pending;
  return <Pause phase={phase} />;
};

const StatefulChild = ({ phase }: PhaseProps) => {
  const [value, setValue] = useState(0);
  const memo = useMemo(() => ({ phase }), [phase]);
  useLayoutEffect(() => {
    committedMemo ??= memo;
    trace.push(`state:${value}:${memo === committedMemo}`);
  }, [memo, value]);
  if (phase === 1) {
    setValue(1);
    throw pending;
  }
  return <span>stateful</span>;
};

export const isExact = true;

export default () => {
  const [phase, setPhase] = useState(0);
  const [snapshot, setSnapshot] = useState("");
  useLayoutEffect(() => {
    if (phase === 0) setPhase(1);
  }, [phase]);
  useEffect(() => {
    if (phase === 1 || phase === 2) {
      const handle = setTimeout(() => setPhase(phase + 1), 0);
      return () => clearTimeout(handle);
    }
    if (phase === 3) setSnapshot(trace.join("|"));
  }, [phase]);
  return (
    <main>
      <Suspense fallback={<i>loading</i>}>
        {phase < 3 ? <Child phase={phase === 2 ? 0 : phase} isNested={false} /> : <b>removed</b>}
      </Suspense>
      <Suspense fallback={<i>loading nested</i>}>
        {phase < 3 ? <Child phase={phase === 2 ? 0 : phase} isNested /> : <b>removed nested</b>}
      </Suspense>
      <Suspense fallback={<i>loading stateful</i>}>
        {phase < 3 ? <StatefulChild phase={phase === 2 ? 0 : phase} /> : <b>removed stateful</b>}
      </Suspense>
      <p>
        {"trace:"}
        {snapshot}
      </p>
    </main>
  );
};
