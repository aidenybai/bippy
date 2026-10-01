import { useEffect, useState } from "react";

export default () => {
  const [isReady, setReady] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    if (context) setTimeout(() => setReady(true), 0);
  }, [context]);
  return (
    <main>
      {context ? <canvas /> : <aside />}
      {isReady ? <strong /> : <span />}
    </main>
  );
};

export const isEnumerated = true;
