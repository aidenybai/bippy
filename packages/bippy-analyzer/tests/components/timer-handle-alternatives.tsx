import { useEffect, useState } from "react";

export default () => {
  const [firstReady, setFirstReady] = useState(false);
  const [secondReady, setSecondReady] = useState(false);
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    const firstTimer = setTimeout(() => setFirstReady(true), 0);
    const secondTimer = setTimeout(() => setSecondReady(true), 0);
    clearTimeout(context ? firstTimer : secondTimer);
    return () => {
      clearTimeout(firstTimer);
      clearTimeout(secondTimer);
    };
  }, [context]);
  return (
    <main>
      {context ? <canvas /> : <aside />}
      {firstReady ? <header /> : <section />}
      {secondReady ? <footer /> : <nav />}
    </main>
  );
};

export const isEnumerated = true;
