import { useEffect, useState } from "react";

export default () => {
  const [order, setOrder] = useState("pending");
  useEffect(() => {
    const events: string[] = [];
    const source = Promise.resolve("ready");
    new Promise<string>((resolve) => resolve(source)).then(() => events.push("adopted"));
    queueMicrotask(() => {
      events.push("first");
      queueMicrotask(() => events.push("second"));
    });
    setTimeout(() => setOrder(events.join(",")), 0);
  }, []);
  return <output>order: {order}</output>;
};

export const isEnumerated = true;
