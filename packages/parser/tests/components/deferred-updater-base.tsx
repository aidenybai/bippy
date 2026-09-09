import { useEffect, useState } from "react";

const load = async (text: string): Promise<number> => {
  const response = await fetch(`data:text/plain,${text}`);
  return (await response.text()).length;
};

/** Each continuation increments from whatever the other continuations have already set. */
const DeferredUpdaterBase = () => {
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    void load("left").then(() => setSettled((current) => current + 1));
    void load("right").then(() => setSettled((current) => current + 1));
  }, []);
  if (settled === 0) return <p>loading</p>;
  if (settled === 1) return <em>one response</em>;
  return <strong>both responses</strong>;
};

export default DeferredUpdaterBase;

export const isPartial = true;
