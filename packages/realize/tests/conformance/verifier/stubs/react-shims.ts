import React from "react";
import type { Context } from "react";

interface SettledThenable {
  status: "pending" | "fulfilled" | "rejected";
  value?: unknown;
  reason?: unknown;
}

const settledThenables = new WeakMap<PromiseLike<unknown>, SettledThenable>();

const isContext = (usable: unknown): usable is Context<unknown> =>
  typeof usable === "object" && usable !== null && "Provider" in usable && "Consumer" in usable;

const isThenable = (usable: unknown): usable is PromiseLike<unknown> =>
  typeof usable === "object" &&
  usable !== null &&
  "then" in usable &&
  typeof usable.then === "function";

const readThenable = (thenable: PromiseLike<unknown>): unknown => {
  const existing = settledThenables.get(thenable);
  if (existing?.status === "fulfilled") return existing.value;
  if (existing?.status === "rejected") throw existing.reason;
  if (!existing) {
    const settled: SettledThenable = { status: "pending" };
    settledThenables.set(thenable, settled);
    thenable.then(
      (value) => Object.assign(settled, { status: "fulfilled", value }),
      (reason: unknown) => Object.assign(settled, { status: "rejected", reason }),
    );
  }
  throw thenable;
};

const use = (usable: unknown): unknown => {
  if (isContext(usable)) return React.useContext(usable);
  if (isThenable(usable)) return readThenable(usable);
  throw new Error("use() expects a context or a promise");
};

const cache = <Callback>(callback: Callback): Callback => callback;

if (typeof Reflect.get(React, "use") !== "function") Reflect.set(React, "use", use);
if (typeof Reflect.get(React, "cache") !== "function") Reflect.set(React, "cache", cache);
