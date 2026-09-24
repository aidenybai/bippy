import { useEffect, useState } from "react";

export default () => {
  const [result, setResult] = useState("pending");
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    const promise = new Promise<boolean>((resolve) => {
      if (context) setTimeout(resolve, 0, true);
      else setTimeout(resolve, 0, false);
    });
    Promise.all([promise, promise]).then(([first, second]) => {
      setResult(first === second ? (first ? "canvas" : "aside") : "invalid");
    });
  }, [context]);
  return (
    <main>
      {context ? <canvas /> : <aside />}
      {result === "pending" ? (
        <span />
      ) : result === "canvas" ? (
        <strong />
      ) : result === "aside" ? (
        <footer />
      ) : (
        <header />
      )}
    </main>
  );
};

export const isEnumerated = true;
