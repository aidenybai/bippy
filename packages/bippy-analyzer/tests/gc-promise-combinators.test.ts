import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getCollectedReference } from "./helpers/concrete-gc.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface CombinatorCase {
  method: "allSettled" | "any";
  outcome: "fulfilled" | "rejected";
}
const cases: CombinatorCase[] = [
  { method: "allSettled", outcome: "fulfilled" },
  { method: "allSettled", outcome: "rejected" },
  { method: "any", outcome: "rejected" },
];
const getObserver = ({ method, outcome }: CombinatorCase, index: number): string =>
  method === "any"
    ? `
        aggregate.catch((error) => {
          seen = error.errors[${index}] === reference.deref();
        });
      `
    : `
        aggregate.then((values) => {
          seen = values[${index}].${outcome === "fulfilled" ? "value" : "reason"} === reference.deref();
        });
      `;
const getSetup = (variant: CombinatorCase, target: string, isReversed = false): string => `
  var reference, aggregate, settle, seen;
  var pending = new Promise((resolve, reject) => {
    settle = ${variant.method === "any" ? "reject" : "resolve"};
  });
  (() => {
    const held = ${target};
    reference = new WeakRef(held);
    const first = Promise.${variant.outcome === "fulfilled" ? "resolve" : "reject"}(held);
    aggregate = Promise.${variant.method}([${isReversed ? "pending,first" : "first,pending"}]);
  })();
  ${getObserver(variant, isReversed ? 1 : 0)}
`;

it.each(
  cases.flatMap((variant) =>
    ["{}", "Symbol('target')"].flatMap((target) =>
      [false, true].map((isReversed) => ({ ...variant, target, isReversed })),
    ),
  ),
)("retains partial $method $outcome $target, reversed=$isReversed", async (variant) => {
  const setup = getSetup(variant, variant.target, variant.isReversed);
  const native = getNativeGcObservation(
    setup,
    `(
      settle(),
      await aggregate.catch(() => {}),
      JSON.stringify([reference.deref() !== undefined, seen])
    )`,
  );
  expect(native).toBe("[true,true]");
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(setup);
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("settle()");
    runtime.drainJobs();
    expect(runtime.readString("JSON.stringify([reference.deref()!==undefined,seen])")).toBe(native);
    runtime.evaluate("aggregate=null");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it.each(cases)(
  "retains $method capability through only its $outcome element callback",
  async ({ method, outcome }) => {
    const setup = `
      var reference, handler;
      class Aggregate extends Promise {
        static resolve(value) {
          return value;
        }
      }
      reference = new WeakRef(
        Aggregate.${method}([
          {
            then(resolve, reject) {
              handler = ${outcome === "fulfilled" ? "resolve" : "reject"};
            },
          },
        ])
      );
      reference.deref().catch(() => {});
    `;
    expect(getNativeGcObservation(setup, "String(reference.deref()!==undefined)")).toBe("true");
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate("handler(7);handler=null");
      runtime.drainJobs();
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(cases)(
  "retains a custom $method capability environment through a $outcome callback",
  async ({ method, outcome }) => {
    const setup = `
      var reference, handler, seen;
      function Aggregate(executor) {
        const held = {};
        reference = new WeakRef(held);
        executor(
          () => {
            seen = reference.deref() === held;
          },
          () => {
            seen = reference.deref() === held;
          }
        );
      }
      Aggregate.resolve = (value) => value;
      Promise.${method}.call(Aggregate, [
        {
          then(resolve, reject) {
            handler = ${outcome === "fulfilled" ? "resolve" : "reject"};
          },
        },
      ]);
    `;
    expect(getNativeGcObservation(setup, "(handler(7),String(seen))")).toBe("true");
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate("handler(7)");
      expect(runtime.readString("String(seen)")).toBe("true");
      runtime.evaluate("handler=null");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(cases)(
  "shares $method accumulator and duplicate-call state after $outcome",
  async (variant) => {
    const firstIndex = variant.outcome === "fulfilled" ? 0 : 1;
    const secondIndex = variant.method === "any" ? 1 : 1 - firstIndex;
    const setup = `
      var reference,
        handlers = [],
        aggregate,
        seen;
      class Aggregate extends Promise {
        static resolve(value) {
          return value;
        }
      }
      aggregate = Aggregate.${variant.method}(
        [0, 1].map((index) => ({
          then(resolve, reject) {
            handlers[index] = [resolve, reject];
          },
        }))
      );
      ${getObserver(variant, 0)}(() => {
        const held = {};
        reference = new WeakRef(held);
        handlers[0][${firstIndex}](held);
      })();
      handlers[0][${firstIndex}](99);
      ${variant.method === "allSettled" ? `handlers[0][${1 - firstIndex}](88);` : ""}
      handlers[0] = null;
      handlers[1][${1 - secondIndex}] = null;
    `;
    const resume = `
      handlers[1][${secondIndex}](7);
      handlers = null;
    `;
    const native = getNativeGcObservation(
      setup,
      `((()=>{${resume}})(), await aggregate.catch(()=>{}), JSON.stringify([reference.deref()!==undefined,seen]))`,
    );
    expect(native).toBe("[true,true]");
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate(resume);
      runtime.drainJobs();
      expect(runtime.readString("JSON.stringify([reference.deref()!==undefined,seen])")).toBe(
        native,
      );
      runtime.evaluate("aggregate=null");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(cases)("does not retain discarded partial $method $outcome cycles", async (variant) => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(getSetup(variant, "{}"));
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate(`
      aggregate = null;
      pending = null;
      settle = null
    `);
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});
