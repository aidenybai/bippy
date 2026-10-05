import { useEffect, useState } from "react";

const trace: string[] = [];
const shared = { phase: 0 };
export const getTrace = () => trace.slice();

const AsyncAwait = () => {
  const [state, setState] = useState({ phase: 0, error: "pending" });
  useEffect(() => {
    const run = async () => {
      trace.push("before");
      try {
        await Promise.resolve();
        shared.phase++;
        shared.phase += await new Promise<number>((resolve) => {
          setTimeout(() => {
            trace.push("timer");
            resolve(2);
          }, 0);
        });
        await Promise.reject(new Error("expected"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        trace.push(`caught:${message}`);
        setState({ phase: shared.phase, error: message });
      } finally {
        trace.push("finally");
      }
    };
    run();
    return () => {
      trace.push(`cleanup:${shared.phase}`);
    };
  }, []);
  return (
    <output>
      {state.phase}:{state.error}
    </output>
  );
};
export default AsyncAwait;
