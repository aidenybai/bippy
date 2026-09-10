import { traverseFiber, type Fiber } from "bippy";
import { expect, it } from "vite-plus/test";
import { createFiber, linkChildren } from "./fiber-fixture.js";

interface ThenableOutcome {
  value?: unknown;
  error?: unknown;
}

const getOutcome = async (run: () => unknown): Promise<ThenableOutcome> => {
  try {
    return { value: await run() };
  } catch (error) {
    return { error };
  }
};

it("reads an actual Promise selector's overridden then accessor once", async () => {
  const root = createFiber({ key: "root" });
  const selection = Promise.resolve(true);
  const originalThen = selection.then;
  const trace: string[] = [];
  // oxlint-disable-next-line unicorn/no-thenable -- A Promise can expose its existing then method through an accessor.
  Object.defineProperty(selection, "then", {
    get: () => {
      trace.push("get");
      if (trace.length !== 1) throw new Error("Promise then accessor was read twice");
      return originalThen;
    },
  });
  const result = traverseFiber(root, () => selection);
  expect(trace).toEqual(["get"]);
  expect(await result).toBe(root);
  expect(trace).toEqual(["get"]);
});

it.each(["resolve", "reject", "throw-after-resolve", "nested", "getter-throw"])(
  "matches native Promise assimilation for accessor thenables: %s",
  async (mode) => {
    const root = createFiber({ key: "root" });
    const branch = createFiber({ key: "branch" });
    const selected = createFiber({ key: "selected" });
    const last = createFiber({ key: "last" });
    linkChildren(root, [branch, last]);
    linkChildren(branch, [selected]);
    const failure = new Error(`thenable ${mode}`);
    const createThenable = (trace: string[], isNested = false): object => {
      const thenable = {};
      let reads = 0;
      // oxlint-disable-next-line unicorn/no-thenable -- Compare a one-shot then accessor with native Promise assimilation.
      Object.defineProperty(thenable, "then", {
        get: () => {
          trace.push(`get:${isNested}`);
          if (++reads !== 1) throw new Error("Then accessor was read more than once");
          if (mode === "getter-throw") throw failure;
          return new Proxy(
            (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
              if (mode === "reject") {
                reject(failure);
                resolve(true);
                return;
              }
              resolve(mode === "nested" && !isNested ? createThenable(trace, true) : !isNested);
              reject(failure);
              resolve(false);
              if (mode === "throw-after-resolve") throw failure;
            },
            {
              apply: (callback, receiver, argumentsList) => {
                trace.push(`call:${isNested}:${receiver === thenable}`);
                return Reflect.apply(callback, receiver, argumentsList);
              },
            },
          );
        },
      });
      return thenable;
    };
    const oracleTrace: string[] = [];
    const oracle = await getOutcome(() => Promise.resolve(createThenable(oracleTrace)));
    const actualTrace: string[] = [];
    const visits: Fiber[] = [];
    const actual = await getOutcome(() =>
      Reflect.apply(traverseFiber, undefined, [
        root,
        (fiber: Fiber) => {
          visits.push(fiber);
          return fiber === selected ? createThenable(actualTrace) : fiber === last;
        },
      ]),
    );
    expect(actualTrace).toEqual(oracleTrace);
    expect(actual.error).toBe(oracle.error);
    expect(actual.value).toBe(oracle.error ? undefined : oracle.value === true ? selected : last);
    expect(visits.map((fiber) => fiber.key)).toEqual(
      oracle.error || oracle.value === true
        ? ["root", "branch", "selected"]
        : ["root", "branch", "selected", "last"],
    );
    const resumed: string[] = [];
    expect(
      traverseFiber(root, (fiber) => {
        resumed.push(String(fiber.key));
      }),
    ).toBeNull();
    expect(resumed).toEqual(["root", "branch", "selected", "last"]);
  },
);
