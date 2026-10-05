import { useEffect, useState } from "react";

export default () => {
  const [isReady, setReady] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    if (context) queueMicrotask(() => setReady(true));
  }, [context]);
  return (
    <main>
      {context ? <canvas /> : <aside />}
      {isReady ? <strong /> : <span />}
    </main>
  );
};

export const isEnumerated = true;
