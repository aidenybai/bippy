import { useEffect, useState } from "react";

export default () => {
  const [isReady, setReady] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    const promise = new Promise<void>((resolve) => {
      if (context) setTimeout(resolve, 0);
    });
    setTimeout(() => promise.then(() => setReady(true)), 0);
  }, [context]);
  return (
    <main>
      {context ? <canvas /> : <aside />}
      {isReady ? <strong /> : <span />}
    </main>
  );
};

export const isEnumerated = true;
