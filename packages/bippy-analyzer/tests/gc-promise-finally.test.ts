import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getCollectedReference } from "./helpers/concrete-gc.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface FinallyCase {
  outcome: "fulfill" | "reject";
  target: string;
}
const cases: FinallyCase[] = ["{}", "Symbol('target')"].flatMap((target) => [
  { outcome: "fulfill", target },
  { outcome: "reject", target },
]);
const getSetup = ({ outcome, target }: FinallyCase): string => `
  var reference, seen, aggregate, fulfillCleanup, rejectCleanup;
  var pending = new Promise((resolve, reject) => {
    fulfillCleanup = resolve;
    rejectCleanup = reject;
  });
  var cleanup = () => pending;
  (() => {
    const held = ${target};
    reference = new WeakRef(held);
    aggregate = Promise.${outcome === "fulfill" ? "resolve" : "reject"}(held).finally(cleanup);
  })();
  aggregate.then(
    (value) => {
      seen = ["fulfill", value === reference.deref()];
    },
    (reason) => {
      seen = ["reject", reason === reference.deref()];
    }
  );
`;

it.each(cases)("retains a $outcome $target while finally cleanup is pending", async (variant) => {
  const setup = getSetup(variant);
  const observation = "JSON.stringify([reference.deref()!==undefined,seen])";
  const native = getNativeGcObservation(
    setup,
    `(fulfillCleanup(),await aggregate.catch(()=>{}),${observation})`,
  );
  expect(native).toBe(JSON.stringify([true, [variant.outcome, true]]));
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(setup);
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("fulfillCleanup()");
    runtime.drainJobs();
    expect(runtime.readString(observation)).toBe(native);
    runtime.evaluate("aggregate=null");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it.each(["fulfill", "reject"])(
  "releases an original %s value when cleanup rejects",
  async (outcome) => {
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(
        getSetup({ outcome: outcome === "fulfill" ? "fulfill" : "reject", target: "{}" }),
      );
      runtime.evaluate(`
        var replacement;
        aggregate.catch((reason) => {
          replacement = reason;
        });
      `);
      runtime.drainJobs();
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate("rejectCleanup('replacement')");
      expect(await getCollectedReference(runtime)).toBe("false");
      runtime.drainJobs();
      expect(runtime.readString("JSON.stringify([replacement,seen])")).toBe(
        '["replacement",["reject",false]]',
      );
    } finally {
      runtime.dispose();
    }
  },
);

it.each(["fulfill", "reject"])(
  "retains the species constructor through a detached %s finally callback",
  async (outcome) => {
    const setup = `
      var reference, handler, seen;
      var cleanup = () => undefined;
      (() => {
        class Species extends Promise {
          constructor(executor) {
            super(executor);
            seen = reference.deref() === new.target;
          }
        }
        reference = new WeakRef(Species);
        Promise.prototype.finally.call(
          {
            constructor: { [Symbol.species]: Species },
            then(resolve, reject) {
              handler = ${outcome === "fulfill" ? "resolve" : "reject"};
            },
          },
          cleanup
        );
      })();
    `;
    expect(getNativeGcObservation(setup, "(await handler(7).catch(()=>{}),String(seen))")).toBe(
      "true",
    );
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate(`
        handler(7).catch(() => {});
        handler = null
      `);
      runtime.drainJobs();
      expect(runtime.readString("String(seen)")).toBe("true");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(cases)(
  "preserves existing cleanup capture roots for $outcome $target",
  async ({ outcome, target }) => {
    const setup = `
      var reference, settle, aggregate, seen;
      var pending = new Promise((resolve, reject) => {
        settle = ${outcome === "fulfill" ? "resolve" : "reject"};
      });
      (() => {
        const held = ${target};
        reference = new WeakRef(held);
        aggregate = pending.finally(() => {
          seen = reference.deref() === held;
        });
      })();
      aggregate.catch(() => {});
    `;
    expect(
      getNativeGcObservation(setup, "(settle(),await aggregate.catch(()=>{}),String(seen))"),
    ).toBe("true");
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate("settle()");
      runtime.drainJobs();
      expect(runtime.readString("String(seen)")).toBe("true");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(["fulfill", "reject"])(
  "retains a detached %s thunk without a Promise queue",
  async (outcome) => {
    const setup = `
      var reference, handler, thunk, seen;
      function Species(executor) {
        executor(
          () => {},
          () => {}
        );
        this.then = (callback) => {
          thunk = callback;
        };
      }
      var cleanup = () => undefined;
      Promise.prototype.finally.call(
        {
          constructor: { [Symbol.species]: Species },
          then(resolve, reject) {
            handler = ${outcome === "fulfill" ? "resolve" : "reject"};
          },
        },
        cleanup
      );
      (() => {
        const held = {};
        reference = new WeakRef(held);
        handler(held);
      })();
      handler = null;
    `;
    const observation = `(() => {
        try {
          seen = thunk() === reference.deref();
        } catch (reason) {
          seen = reason === reference.deref();
        }
        return String(seen);
      })()`;
    expect(getNativeGcObservation(setup, observation)).toBe("true");
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      expect(runtime.readString(observation)).toBe("true");
      runtime.evaluate("thunk=null");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(["fulfill", "reject"])(
  "does not root discarded pending %s cleanup cycles",
  async (outcome) => {
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(
        getSetup({ outcome: outcome === "fulfill" ? "fulfill" : "reject", target: "{}" }),
      );
      runtime.drainJobs();
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate(
        `
          aggregate = null;
          pending = null;
          cleanup = null;
          fulfillCleanup = null;
          rejectCleanup = null
        `,
      );
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);
