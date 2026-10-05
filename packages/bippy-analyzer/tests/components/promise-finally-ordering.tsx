import { useEffect, useState } from "react";

export default () => {
  const [order, setOrder] = useState("pending");
  useEffect(() => {
    const events: string[] = [];
    Promise.resolve()
      .finally(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              events.push("cleanup");
              resolve();
            }, 0);
          }),
      )
      .then(() => {
        events.push("done");
        setOrder(events.join(","));
      });
  }, []);
  return <output>order: {order}</output>;
};

export const isEnumerated = true;
