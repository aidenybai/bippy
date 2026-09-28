import { createContext, Script } from "node:vm";

interface NativeTimer {
  callback: (...args: unknown[]) => unknown;
  args: unknown[];
}

export const createNativeRuntime = () => {
  const timers = new Map<number, NativeTimer>();
  const consoleEntries: unknown[][] = [];
  let nextTimer = 0;
  const context = createContext(
    {
      setTimeout: (callback: NativeTimer["callback"], delay = 0, ...args: unknown[]) => {
        if (typeof callback !== "function" || typeof delay !== "number" || delay !== 0)
          throw new Error("Unsupported reference timer");
        const handle = ++nextTimer;
        timers.set(handle, { callback, args });
        return handle;
      },
      clearTimeout: (handle: number) => {
        timers.delete(handle);
      },
      console: {
        info: (...args: unknown[]) => {
          consoleEntries.push(["info", ...args]);
        },
        log: (...args: unknown[]) => {
          consoleEntries.push(["log", ...args]);
        },
        warn: (...args: unknown[]) => {
          consoleEntries.push(["warn", ...args]);
        },
        error: (...args: unknown[]) => {
          consoleEntries.push(["error", ...args]);
        },
      },
    },
    { microtaskMode: "afterEvaluate" },
  );
  const evaluate = (source: string): unknown =>
    new Script(source).runInContext(context, { timeout: 10_000 });
  evaluate(
    "globalThis.global = globalThis; globalThis.queueMicrotask = callback => Promise.resolve().then(callback)",
  );
  return {
    evaluate,
    consoleEntries,
    drainJobs: () => {
      for (let count = 0; timers.size; count++) {
        if (count === 512) throw new Error("Reference job budget exceeded");
        const entry = timers.entries().next().value;
        if (!entry) throw new Error("Missing reference timer");
        timers.delete(entry[0]);
        context.runTimer = () => Reflect.apply(entry[1].callback, undefined, entry[1].args);
        evaluate("runTimer()");
        delete context.runTimer;
      }
    },
  };
};
