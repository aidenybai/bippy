import { useEffect, useState } from "react";

export default () => {
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => {
    const append = (event: string) => setEvents((previous) => [...previous, event]);
    const run = async () => {
      append("entered");
      // eslint-disable-next-line unicorn/no-unnecessary-await -- The primitive microtask boundary is the regression.
      await 1;
      append("primitive");
      queueMicrotask(() => append("between"));
      await Promise.resolve("ready");
      append("settled");
    };
    queueMicrotask(() => append("queued"));
    void run();
    append("sync");
  }, []);
  return <main>events: {events.join(",")}</main>;
};
