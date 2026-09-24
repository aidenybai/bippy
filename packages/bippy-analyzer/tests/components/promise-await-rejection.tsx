import { useEffect, useState } from "react";

export default () => {
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => {
    const append = (event: string) => setEvents((previous) => [...previous, event]);
    const throwNow = () => {
      throw new Error("synchronous");
    };
    const runThrow = async () => {
      try {
        await throwNow();
      } catch {
        append("throw");
      }
    };
    const runReject = async () => {
      try {
        await Promise.reject(new Error("asynchronous"));
      } catch {
        append("rejection");
      } finally {
        append("finally");
      }
    };
    queueMicrotask(() => append("queued"));
    void runThrow();
    void runReject();
    append("sync");
  }, []);
  return <main>events: {events.join(",")}</main>;
};
