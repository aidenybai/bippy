import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getCollectedReference } from "./helpers/concrete-gc.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

const cases = ["{}", "Symbol('target')"].flatMap((target) =>
  ["fulfill", "reject"].map((outcome) => ({ target, outcome })),
);
const observation = "JSON.stringify([reference.deref() !== undefined, seen])";

it.each(cases)(
  "retains a pending and queued $outcome handler's $target",
  async ({ target, outcome }) => {
    const setup = `
      var reference, seen, fulfill, reject;
      var promise = new Promise((resolve, fail) => {
        fulfill = resolve;
        reject = fail;
      });
      (() => {
        const target = ${target};
        reference = new WeakRef(target);
        const observe = () => {
          seen = reference.deref() === target;
        };
        promise.then(${outcome === "fulfill" ? "observe, undefined" : "undefined, observe"});
      })();
    `;
    const native = getNativeGcObservation(
      setup,
      `(${outcome}(), globalThis.gc(), await Promise.resolve(), ${observation})`,
    );
    expect(native).toBe("[true,true]");
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate(`${outcome}()`);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.drainJobs();
      expect(runtime.readString(observation)).toBe(native);
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(cases)(
  "retains $target as a queued $outcome argument through an empty handler",
  async ({ target, outcome }) => {
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(`
        var reference, seen;
        (() => {
          const target = ${target};
          reference = new WeakRef(target);
          const observe = (value) => {
            seen = reference.deref() === value;
          };
          Promise.${outcome === "fulfill" ? "resolve" : "reject"}(target).then().then(observe, observe);
        })();
      `);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.drainJobs();
      expect(runtime.readString(observation)).toBe("[true,true]");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each(["fulfill", "reject"])(
  "retains a custom species capability's %s callback",
  async (outcome) => {
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(`
        var reference, seen, fulfill, reject;
        var promise = new Promise((resolve, fail) => {
          fulfill = resolve;
          reject = fail;
        });
        promise.constructor = {
          [Symbol.species]: function (executor) {
            const target = {};
            reference = new WeakRef(target);
            executor(
              () => {
                seen = reference.deref() === target;
              },
              () => {
                seen = reference.deref() === target;
              }
            );
          },
        };
        promise.then();
      `);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate(`${outcome}()`);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.drainJobs();
      expect(runtime.readString(observation)).toBe("[true,true]");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it("retains the reaction's result Promise until its queued job completes", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var fulfill;
      var promise = new Promise((resolve) => {
        fulfill = resolve;
      });
      var reference = new WeakRef(promise.then());
    `);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("fulfill()");
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it.each(["fulfill", "reject"])(
  "retains a Promise through its resolving functions and releases it on %s",
  async (outcome) => {
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(`
        var reference, seen, fulfill, reject;
        (() => {
          const promise = new Promise((resolve, fail) => {
            fulfill = resolve;
            reject = fail;
          });
          reference = new WeakRef(promise);
          promise.then(
            () => {
              seen = true;
            },
            () => {
              seen = true;
            }
          );
        })();
      `);
      expect(await getCollectedReference(runtime)).toBe("true");
      runtime.evaluate(`
        ${outcome}();
        fulfill();
        reject();
      `);
      runtime.drainJobs();
      expect(runtime.readString("String(seen)")).toBe("true");
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it("retains a thenable receiver until assimilation runs", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var reference, seen;
      (() => {
        const thenable = {
          then(resolve) {
            seen = reference.deref() === this;
            resolve();
          },
        };
        reference = new WeakRef(thenable);
        Promise.resolve(thenable);
      })();
    `);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.drainJobs();
    expect(runtime.readString(observation)).toBe("[true,true]");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("retains a detached then callback and its captures until assimilation runs", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var reference, seen;
      (() => {
        const target = {};
        reference = new WeakRef(target);
        Promise.resolve({
          get then() {
            delete this.then;
            return (resolve) => {
              seen = reference.deref() === target;
              resolve();
            };
          },
        });
      })();
    `);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.drainJobs();
    expect(runtime.readString(observation)).toBe("[true,true]");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("retains the assimilation job's result Promise", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var reference, seen;
      reference = new WeakRef(
        Promise.resolve({
          then(resolve) {
            seen = reference.deref() !== undefined;
            resolve();
          },
        })
      );
    `);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.drainJobs();
    expect(runtime.readString("String(seen)")).toBe("true");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("releases an unselected reaction before draining the selected job", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var reference, fulfill;
      var promise = new Promise((resolve) => {
        fulfill = resolve;
      });
      (() => {
        const target = {};
        reference = new WeakRef(target);
        promise.then(undefined, () => target);
      })();
    `);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("fulfill()");
    expect(await getCollectedReference(runtime)).toBe("false");
    runtime.drainJobs();
  } finally {
    runtime.dispose();
  }
});

it("keeps Promise roots and collection independent across Agents", async () => {
  const first = await createConcreteRuntime();
  const second = await createConcreteRuntime();
  try {
    const setup = `
      var reference, fulfill;
      var promise = new Promise((resolve) => {
        fulfill = resolve;
      });
      (() => {
        const target = {};
        reference = new WeakRef(target);
        promise.then(() => {
          if (reference.deref() !== target) throw new Error("lost target");
        });
      })();
    `;
    first.evaluate(setup);
    second.evaluate(setup);
    expect(await getCollectedReference(first)).toBe("true");
    expect(await getCollectedReference(second)).toBe("true");
    first.evaluate("fulfill()");
    first.drainJobs();
    expect(await getCollectedReference(first)).toBe("false");
    expect(await getCollectedReference(second)).toBe("true");
    second.evaluate("fulfill()");
    second.drainJobs();
    expect(await getCollectedReference(second)).toBe("false");
  } finally {
    first.dispose();
    second.dispose();
  }
});

it("does not root an unreachable pending Promise cycle", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var reference;
      (() => {
        const promise = new Promise(() => {});
        reference = new WeakRef(promise);
        promise.then(() => promise);
      })();
    `);
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});
