import { useEffect, useState } from "react";

export default () => {
  const [result, setResult] = useState("pending");
  useEffect(() => {
    let settle: (value: unknown) => void = () => {};
    const promise = new Promise<unknown>((resolve) => {
      settle = resolve;
    });
    settle(promise);
    promise.catch((error) => {
      setResult(error instanceof TypeError ? error.name : "wrong error");
    });
  }, []);
  return <output>result: {result}</output>;
};

export const isEnumerated = true;
