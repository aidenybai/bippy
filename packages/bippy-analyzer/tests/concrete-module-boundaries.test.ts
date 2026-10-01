import { expect, it } from "vitest";
import { createConcreteRuntime } from "../src/index.js";

it.each(["node:fs", "data:text/javascript,export default 1", "virtual:entry"])(
  "rejects unsupported artifact protocols: %s",
  async (specifier) => {
    await expect(createConcreteRuntime({ modules: [{ specifier, source: "" }] })).rejects.toThrow(
      "artifact URLs",
    );
  },
);

it("rejects import attributes without executing the supplied JavaScript artifact", async () => {
  const runtime = await createConcreteRuntime({
    modules: [
      {
        specifier: "https://fixture.invalid/data.js",
        source: `
          globalThis.executed = true;
          export default 1;
        `,
      },
    ],
  });
  try {
    runtime.evaluate(`import("https://fixture.invalid/data.js", { with: { type: "json" } }).then(
        () => {
          globalThis.result = "wrong";
        },
        () => {
          globalThis.result = typeof executed;
        }
      );`);
    runtime.drainJobs();
    expect(runtime.readString("result")).toBe("undefined");
  } finally {
    runtime.dispose();
  }
});

it("preserves engine syntax errors at the module boundary", async () => {
  const runtime = await createConcreteRuntime({
    modules: [{ specifier: "https://fixture.invalid/entry.js", source: "export const =" }],
  });
  try {
    runtime.evaluate(
      `import("https://fixture.invalid/entry.js").catch((error) => {
          globalThis.result = error.name;
        });`,
    );
    runtime.drainJobs();
    expect(runtime.readString("result")).toBe("SyntaxError");
  } finally {
    runtime.dispose();
  }
});

it("uses engine-owned module namespace objects and live bindings", async () => {
  const runtime = await createConcreteRuntime({
    modules: [
      {
        specifier: "https://fixture.invalid/entry.js",
        source: `
          export let count = 0;
          export const increment = () => count++;
        `,
      },
    ],
  });
  try {
    runtime.evaluate(`import("https://fixture.invalid/entry.js").then((module) => {
        const writable = Reflect.set(module, "count", 99);
        module.increment();
        globalThis.result = JSON.stringify([
          writable,
          Object.getPrototypeOf(module),
          Object.isExtensible(module),
          Object.keys(module),
          module.count,
        ]);
      });`);
    runtime.drainJobs();
    expect(runtime.readString("result")).toBe('[false,null,false,["count","increment"],1]');
  } finally {
    runtime.dispose();
  }
});

it("does not turn unresolved top-level await into a completed import", async () => {
  const runtime = await createConcreteRuntime({
    modules: [
      {
        specifier: "https://fixture.invalid/entry.js",
        source: `
          await new Promise(() => {});
          export default 1;
        `,
      },
    ],
  });
  try {
    runtime.evaluate(
      `
        let finished = false;
        import("https://fixture.invalid/entry.js").then(() => {
          finished = true;
        });
      `,
    );
    runtime.drainJobs();
    expect(runtime.readString("String(finished)")).toBe("false");
  } finally {
    runtime.dispose();
  }
});
