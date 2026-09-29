import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { withFixture } from "./helpers/engine-fixture.js";
import { getNativeGcObservation as getNativeObservation } from "./helpers/native-gc.js";

const cases = [
  {
    name: "global lexical binding",
    setup: `
      let retained = {};
      var reference = new WeakRef(retained);
    `,
    observation: "JSON.stringify([typeof retained, reference.deref() === retained])",
  },
  {
    name: "captured block binding",
    setup: `
      var read;
      {
        const retained = {};
        read = () => retained;
      }
      var reference = new WeakRef(read());
    `,
    observation: "JSON.stringify([typeof read(), reference.deref() === read()])",
  },
  {
    name: "captured parameter binding",
    setup: `
      var read = (
        (retained) => () =>
          retained
      )({});
      var reference = new WeakRef(read());
    `,
    observation: "JSON.stringify([typeof read(), reference.deref() === read()])",
  },
  {
    name: "lexical symbol binding",
    setup: `
      let retained = Symbol("retained");
      var reference = new WeakRef(retained);
    `,
    observation: "JSON.stringify([typeof retained, reference.deref() === retained])",
  },
];

it.each(cases)("marks values held by $name", async (fixture) => {
  const expected = getNativeObservation(fixture.setup, fixture.observation);
  expect(JSON.parse(expected)[1]).toBe(true);
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(fixture.setup);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString(fixture.observation)).toBe(expected);
  });
});

it("marks captured values reachable only through a saved getter", async () => {
  const setup = `
    var holder = (() => {
      const retained = {};
      return {
        get value() {
          return retained;
        },
      };
    })();
    var reference = new WeakRef(holder.value);
  `;
  const expected = getNativeObservation(
    `
      ${setup}
      var saved = Object.getOwnPropertyDescriptor(holder, "value").get;
      delete holder.value;
    `,
    "JSON.stringify([typeof saved(), reference.deref() === saved()])",
  );
  expect(expected).toBe('["object",true]');
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(setup);
    const checkpoint = api.createOrdinaryObjectCheckpoint([getObject("holder")]);
    try {
      evaluate("delete holder.value");
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      checkpoint.restore();
      expect(
        readString("JSON.stringify([typeof holder.value, reference.deref() === holder.value])"),
      ).toBe(expected);
    } finally {
      checkpoint.release();
    }
  });
});

it.each(["retained", "forwarded"])(
  "marks values held by %s module bindings",
  async (entrypoint) => {
    const retainedSource = `
      const retained = {};
      export const read = () => retained;
    `;
    const getForwardingSource = (specifier: string) =>
      `import { read as original } from ${JSON.stringify(specifier)}; export const read = () => original();`;
    const nativeRetainedUrl = `data:text/javascript,${encodeURIComponent(retainedSource)}`;
    const nativeEntrypoint =
      entrypoint === "retained"
        ? nativeRetainedUrl
        : `data:text/javascript,${encodeURIComponent(getForwardingSource(nativeRetainedUrl))}`;
    const observation = "JSON.stringify([typeof read(), reference.deref() === read()])";
    const expected = getNativeObservation(
      `
        const { read } = await import(${JSON.stringify(nativeEntrypoint)});
        const reference = new WeakRef(read());
      `,
      observation,
    );
    expect(expected).toBe('["object",true]');
    const { api } = await getSymbolicEngine();
    const runtime = await createConcreteRuntime({
      modules: [
        { specifier: "file:///retained.js", source: retainedSource },
        { specifier: "file:///forwarded.js", source: getForwardingSource("./retained.js") },
      ],
    });
    const previous = api.surroundingAgent;
    try {
      runtime.evaluate(
        `var read, reference; import('file:///${entrypoint}.js').then(namespace => { read = namespace.read; reference = new WeakRef(read()); });`,
      );
      await runtime.drainJobs();
      api.setSurroundingAgent(runtime.agent);
      const pop = runtime.realm.pushTopContext();
      try {
        runtime.agent.AgentRecord.KeptAlive.clear();
        api.gc();
        expect(runtime.readString(observation)).toBe(expected);
      } finally {
        pop?.();
      }
    } finally {
      api.setSurroundingAgent(previous);
      runtime.dispose();
    }
  },
);

it("stops retaining values after their binding is cleared", async () => {
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(`
      let retained = {};
      var reference = new WeakRef(retained);
    `);
    evaluate("retained = undefined");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() === undefined)")).toBe("true");
  });
});
