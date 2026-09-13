import { useEffect, useState } from "react";

export default () => {
  const [result, setResult] = useState("pending");
  useEffect(() => {
    const adopted = new Promise<string>((resolve) => setTimeout(resolve, 0, "adopted"));
    const promise = new Promise<string>((resolve, reject) => {
      resolve(adopted);
      reject(new Error("late rejection"));
      resolve("late fulfillment");
    });
    promise.then(setResult, () => setResult("rejected"));
  }, []);
  return <output>result: {result}</output>;
};

export const isEnumerated = true;
