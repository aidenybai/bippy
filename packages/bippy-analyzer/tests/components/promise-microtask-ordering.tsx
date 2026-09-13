import { useEffect, useState } from "react";

export default () => {
  const [order, setOrder] = useState("pending");
  useEffect(() => {
    const events: string[] = [];
    const promises = [Promise.resolve("ready")];
    Promise.all(promises).then(() => events.push("all"));
    queueMicrotask(() => events.push("microtask"));
    setTimeout(() => setOrder(events.join(",")), 0);
  }, []);
  return <output>order: {order}</output>;
};

export const isEnumerated = true;
