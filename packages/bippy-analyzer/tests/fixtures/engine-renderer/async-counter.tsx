import { useEffect, useState } from "react";

const trace: string[] = [];
const store = { count: 2 };
const read = () => store.count;
export const getTrace = () => trace.slice();

interface CounterProps {
  enabled?: boolean;
}
const AsyncCounter = ({ enabled = true }: CounterProps) => {
  const [count, setCount] = useState(() => read());
  useEffect(() => {
    trace.push(`effect:${read()}`);
    const handle = enabled
      ? setTimeout(() => {
          trace.push("timer");
          Promise.resolve().then(() => {
            store.count++;
            trace.push(`promise:${read()}`);
            setCount((previous) => previous + read());
          });
        }, 0)
      : undefined;
    return () => {
      clearTimeout(handle);
      trace.push(`cleanup:${read()}`);
    };
  }, []);
  return (
    <output>
      {count}:{read()}
    </output>
  );
};
export default AsyncCounter;
