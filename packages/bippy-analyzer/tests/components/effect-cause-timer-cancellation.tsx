import { useLayoutEffect, useState } from "react";

interface CancellationProps {
  handle: ReturnType<typeof setTimeout>;
}

const Cancellation = ({ handle }: CancellationProps) => {
  useLayoutEffect(() => clearTimeout(handle), [handle]);
  return <canvas />;
};

export default () => {
  const [hasFired, setFired] = useState(false);
  const [handle] = useState(() => setTimeout(() => setFired(true), 0));
  const [firstContext] = useState(() => document.createElement("canvas").getContext("2d"));
  const [secondContext] = useState(() => document.createElement("canvas").getContext("2d"));
  return (
    <main>
      {firstContext ? <Cancellation handle={handle} /> : <aside />}
      {secondContext ? <Cancellation handle={handle} /> : <section />}
      <p>fired: {Number(hasFired)}</p>
    </main>
  );
};

export const isEnumerated = true;
