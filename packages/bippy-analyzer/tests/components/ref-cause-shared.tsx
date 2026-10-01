import { useCallback, useState } from "react";

export default () => {
  const [isReady, setReady] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  const ref = useCallback((element: HTMLElement | null) => {
    if (element) setReady(true);
  }, []);
  return (
    <main>
      {context ? <div ref={ref} /> : <section ref={ref} />}
      {isReady ? <strong>ready</strong> : <span>waiting</span>}
    </main>
  );
};

export const isEnumerated = true;
