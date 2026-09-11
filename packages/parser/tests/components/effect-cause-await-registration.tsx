import { useEffect, useState } from "react";

export default () => {
  const [isReady, setReady] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    const update = async () => {
      // eslint-disable-next-line unicorn/no-unnecessary-await -- The primitive microtask boundary is the regression.
      await 1;
      setReady(true);
    };
    if (context) void update();
  }, [context]);
  return (
    <main>
      {context ? <canvas /> : <aside />}
      {isReady ? <strong /> : <span />}
    </main>
  );
};

export const isEnumerated = true;
