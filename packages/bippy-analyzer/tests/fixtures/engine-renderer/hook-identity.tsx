import { useEffect, useMemo, useRef, useState } from "react";

const trace: string[] = [];
export const getTrace = () => trace.slice();

const HookIdentity = () => {
  const [count, setCount] = useState(0);
  const previousSetter = useRef(setCount);
  const renders = useRef(0);
  renders.current++;
  const label = useMemo(() => `count:${count}`, [count]);
  useEffect(() => {
    trace.push(`effect:${count}`);
    if (count === 0) setCount(1);
    else setCount(1);
    return () => {
      trace.push(`cleanup:${count}`);
    };
  }, [count]);
  return (
    <output>
      {label}:{String(previousSetter.current === setCount)}:{renders.current}
    </output>
  );
};
export default HookIdentity;
