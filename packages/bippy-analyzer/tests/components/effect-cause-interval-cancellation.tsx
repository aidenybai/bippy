import { useLayoutEffect, useState } from "react";

interface CancellationProps {
  handle: ReturnType<typeof setInterval>;
}

const Cancellation = ({ handle }: CancellationProps) => {
  useLayoutEffect(() => clearInterval(handle), [handle]);
  return <canvas />;
};

export default () => {
  const [hasFired, setFired] = useState(false);
  const [handle] = useState(() =>
    setInterval(() => {
      setFired(true);
      clearInterval(handle);
    }, 0),
  );
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  return (
    <main>
      {context ? <Cancellation handle={handle} /> : <aside />}
      <p>fired: {Number(hasFired)}</p>
    </main>
  );
};

export const isEnumerated = true;
