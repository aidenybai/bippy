import { useEffect, useLayoutEffect, useState } from "react";

interface ChildProps {
  name: string;
  phase: number;
}

const trace: string[] = [];

const Child = ({ name, phase }: ChildProps) => {
  useLayoutEffect(() => {
    trace.push(`layout:${name}:${phase}`);
    return () => {
      trace.push(`layout-clean:${name}:${phase}`);
    };
  }, [name, phase]);
  useEffect(() => {
    trace.push(`passive:${name}:${phase}`);
    return () => {
      trace.push(`passive-clean:${name}:${phase}`);
      queueMicrotask(() => trace.push(`microtask:${name}:${phase}`));
    };
  }, [name, phase]);
  return <span>{name}</span>;
};

export const isExact = true;

export default () => {
  const [phase, setPhase] = useState(0);
  const [snapshot, setSnapshot] = useState("");
  useLayoutEffect(() => {
    if (phase === 0) setPhase(1);
  }, [phase]);
  useEffect(() => {
    if (phase === 1) setTimeout(() => setPhase(2), 0);
    if (phase === 2) setTimeout(() => setSnapshot(trace.join("|")), 0);
  }, [phase]);
  return (
    <main>
      <Child name="first" phase={phase} />
      <Child name="second" phase={phase} />
      <p>
        {"trace:"}
        {snapshot}
      </p>
    </main>
  );
};
