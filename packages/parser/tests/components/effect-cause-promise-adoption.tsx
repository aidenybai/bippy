import { useEffect, useState } from "react";

export default () => {
  const [result, setResult] = useState("pending");
  const [context] = useState(() => document.createElement("canvas").getContext("2d"));
  useEffect(() => {
    const source = new Promise<string>((resolve) => setTimeout(resolve, 0, "canvas"));
    const promise = new Promise<string>((resolve, reject) => {
      if (context) resolve(source);
      reject("fallback");
    });
    promise.then(setResult, () => setResult("aside"));
  }, [context]);
  return (
    <main>
      {context ? <canvas /> : <aside />}
      {result === "pending" ? <span /> : result === "canvas" ? <strong /> : <footer />}
    </main>
  );
};

export const isEnumerated = true;
