import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { withFixture } from "./helpers/engine-fixture.js";

const setups = [
  `
    var saved, readParameter, writeParameter;
    (function(first, second) {
      saved = arguments;
      readParameter = () => first;
      writeParameter = value => { first = value; };
    })(1, 2);
  `,
  `
    var saved, readParameter, writeParameter;
    (function(first, second, first) {
      saved = arguments;
      readParameter = () => first;
      writeParameter = value => { first = value; };
    })(1, 2, 3);
  `,
  `
    var saved, readParameter, writeParameter;
    (function(first) {
      saved = arguments;
      readParameter = () => first;
      writeParameter = value => { first = value; };
    })();
  `,
];

const observe = `
  JSON.stringify({
    parameter: readParameter(),
    values: Array.prototype.slice.call(saved),
    keys: Reflect.ownKeys(saved).map(key => String(key)),
    descriptor: Object.getOwnPropertyDescriptor(saved, "0"),
    extensible: Object.isExtensible(saved),
    frozen: Object.isFrozen(saved)
  });
`;

const branches = [
  `
    writeParameter(41);
    saved[1] = 42;
    delete saved[0];
    saved[0] = 43;
    saved.extra = saved;
  `,
  `
    saved[0] = 40;
    Object.defineProperty(saved, "0", { writable: false });
    writeParameter(51);
    Object.freeze(saved);
  `,
  `
    saved[0] = 60;
    Object.defineProperty(saved, "0", { get() { return 61; }, configurable: true });
    writeParameter(62);
    Object.setPrototypeOf(saved, null);
  `,
];

for (const [setupIndex, setup] of setups.entries()) {
  for (const reverse of [false, true]) {
    it(`restores mapped arguments and aliases for shape ${setupIndex}, reverse=${reverse}`, async () => {
      await withFixture(({ api, evaluate, getObject, readString }) => {
        evaluate(setup);
        const argumentsObject = getObject("saved");
        if (!api.isArgumentExoticObject(argumentsObject) || !argumentsObject.ParameterMap)
          throw Error("Expected mapped arguments");
        const parameterMap = argumentsObject.ParameterMap;
        const initialGet = parameterMap.GetOwnProperty;
        const initialKeys = parameterMap.OwnPropertyKeys;
        const initialSize = parameterMap.properties.size;
        const checkpoint = api.createStateCheckpoint({ objects: [argumentsObject] });
        expect(checkpoint.objectCount).toBe(2);
        expect(checkpoint.environmentCount).toBe(1);
        expect(parameterMap.properties.size).toBe(initialSize);
        const orderedBranches = reverse ? [...branches].reverse() : branches;
        for (const branch of orderedBranches) {
          evaluate(branch);
          expect(readString(observe)).toBe(runInNewContext(setup + branch + observe));
          checkpoint.restore();
          expect(argumentsObject.ParameterMap).toBe(parameterMap);
          expect(parameterMap.GetOwnProperty).toBe(initialGet);
          expect(parameterMap.OwnPropertyKeys).toBe(initialKeys);
          expect(parameterMap.properties.size).toBe(initialSize);
          expect(getObject("saved")).toBe(argumentsObject);
          expect(readString(observe)).toBe(runInNewContext(setup + observe));
          checkpoint.restore();
        }
        checkpoint.release();
      });
    });
  }
}

it.each([false, true])(
  "restores partially initialized lazy maps, eager debugger=%s",
  async (eager) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      if (eager) api.surroundingAgent.hostDefinedOptions.onDebugger = () => {};
      evaluate(setups[0]);
      evaluate("saved[0]");
      const argumentsObject = getObject("saved");
      if (!api.isArgumentExoticObject(argumentsObject) || !argumentsObject.ParameterMap)
        throw Error("Expected mapped arguments");
      const parameterMap = argumentsObject.ParameterMap;
      const getter = parameterMap.properties.get("0")?.Get;
      const initialSize = parameterMap.properties.size;
      const checkpoint = api.createStateCheckpoint({ objects: [argumentsObject, parameterMap] });
      expect(checkpoint.objectCount).toBe(2);
      evaluate("saved[1]; saved[0] = 81; delete saved[1]");
      checkpoint.restore();
      expect(parameterMap.properties.size).toBe(initialSize);
      expect(parameterMap.properties.get("0")?.Get).toBe(getter);
      expect(readString(observe)).toBe(runInNewContext(setups[0] + observe));
      checkpoint.release();
    });
  },
);

it.each([
  `
    var saved;
    (function(first) { "use strict"; saved = arguments; })(1);
  `,
  `
    var saved;
    (function(first = 1) { saved = arguments; })(2);
  `,
])("restores unmapped arguments without selecting an environment: %s", async (setup) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(setup);
    const argumentsObject = getObject("saved");
    const checkpoint = api.createStateCheckpoint({ objects: [argumentsObject] });
    expect(checkpoint.objectCount).toBe(1);
    expect(checkpoint.environmentCount).toBe(0);
    const observation = `
      JSON.stringify([Array.from(saved), Object.isFrozen(saved),
        Object.getOwnPropertyDescriptor(saved, "callee").configurable]);
    `;
    evaluate("saved[0] = 9; Object.freeze(saved)");
    checkpoint.restore();
    expect(readString(observation)).toBe(runInNewContext(setup + observation));
    checkpoint.release();
  });
});

it("supports nested captures before and after mapping initialization", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(setups[0]);
    const argumentsObject = getObject("saved");
    const outer = api.createStateCheckpoint({ objects: [argumentsObject] });
    evaluate("saved[0] = 7");
    const innerBaseline = readString(observe);
    const inner = api.createStateCheckpoint({ objects: [argumentsObject] });
    evaluate("Object.freeze(saved); writeParameter(90)");
    expect(() => outer.restore()).toThrow("last-in-first-out");
    inner.restore();
    expect(readString(observe)).toBe(innerBaseline);
    inner.release();
    outer.restore();
    expect(readString(observe)).toBe(runInNewContext(setups[0] + observe));
    outer.release();
  });
});

it.each([false, true])(
  "roots parameter bindings through lazy/initialized arguments, initialized=%s",
  async (initialized) => {
    await withFixture(({ api, evaluate, readString }) => {
      evaluate(`
      var saved, reference;
      (function(parameter) {
        parameter = { value: 7 };
        reference = new WeakRef(parameter);
        saved = arguments;
      })(null);
    `);
      if (initialized) evaluate("saved[0]");
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("JSON.stringify([reference.deref() === saved[0], saved[0].value])")).toBe(
        "[true,7]",
      );
    });
  },
);

it("retains saved parameter cells until release without retaining severed live aliases", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var saved, reference;
      (function(parameter) {
        parameter = { value: 7 };
        reference = new WeakRef(parameter);
        saved = arguments;
      })(null);
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("saved")] });
    evaluate("delete saved[0]");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref().value)")).toBe("7");
    checkpoint.restore();
    expect(readString("JSON.stringify(saved[0].value)")).toBe("7");
    evaluate("delete saved[0]");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() === undefined)")).toBe("true");
  });
});

it("roots a detached mapped getter through its declared Env slot", async () => {
  await withFixture(({ api, realm, evaluate, getObject, readString }) => {
    evaluate(`
      var saved, reference;
      (function(parameter) {
        parameter = { value: 7 };
        reference = new WeakRef(parameter);
        saved = arguments;
      })(null);
      saved[0];
    `);
    const argumentsObject = getObject("saved");
    if (!api.isArgumentExoticObject(argumentsObject) || !argumentsObject.ParameterMap)
      throw Error("Expected mapped arguments");
    const getter = argumentsObject.ParameterMap.properties.get("0")?.Get;
    if (!(getter instanceof api.ObjectValue)) throw Error("Expected mapped getter");
    api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "savedGetter", getter));
    evaluate("saved = null");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(
      readString("JSON.stringify([reference.deref() === savedGetter(), savedGetter().value])"),
    ).toBe("[true,7]");
  });
});

it.each([false, true])(
  "forks argument aliases without prefix replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      evaluate(setups[0]);
      createBoolean("enabled");
      const argumentsObject = realm.GlobalObject.properties.get("saved")?.Value;
      if (!(argumentsObject instanceof api.ObjectValue)) throw Error("Expected arguments");
      let prefixCount = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixCount++;
      };
      const source = `
      void 1;
      if (enabled) {
        saved[0] = 71;
        Object.freeze(saved);
        writeParameter(72);
      } else {
        writeParameter(81);
        delete saved[0];
      }
      ${observe}
    `;
      agent.evaluate(compile(source), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected abstract decision");
      const contexts = [...agent.executionContextStack];
      let storage: StateCheckpoint | undefined;
      const checkpoint = agent.captureEvaluation({
        capture: () => {
          const state = api.createStateCheckpoint({ objects: [argumentsObject] });
          storage = state;
          return {
            restore: () => {
              state.restore();
              agent.executionContextStack.splice(
                0,
                agent.executionContextStack.length,
                ...contexts,
              );
            },
          };
        },
      });
      try {
        for (const enabled of isReversed ? [true, false] : [false, true]) {
          checkpoint.restore();
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          const result = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: enabled,
            },
          });
          if (!result.done) throw Error("Expected completion");
          const completion = api.EnsureCompletion(result.value);
          if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected observation");
          expect(completion.Value.stringValue()).toBe(
            runInNewContext(setups[0] + source, { enabled }),
          );
          expect(realm.GlobalObject.properties.get("saved")?.Value).toBe(argumentsObject);
        }
      } finally {
        checkpoint.release();
        storage?.release();
      }
      expect(prefixCount).toBe(1);
    });
  },
);

it.each(["parameter-map", "lazy-data", "lazy-method"])(
  "preflights changed %s before selected writes",
  async (change) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      evaluate(setups[0] + "var extra = { value: 1 }");
      const argumentsObject = getObject("saved");
      const extra = getObject("extra");
      if (!api.isArgumentExoticObject(argumentsObject) || !argumentsObject.ParameterMap)
        throw Error("Expected mapped arguments");
      const parameterMap = argumentsObject.ParameterMap;
      const checkpoint = api.createStateCheckpoint({ objects: [extra, argumentsObject] });
      evaluate("extra.value = 2; writeParameter(3)");
      const target = change === "parameter-map" ? argumentsObject : parameterMap;
      const key =
        change === "parameter-map"
          ? "ParameterMap"
          : change === "lazy-data"
            ? "ArgumentsParameterMapData"
            : "GetOwnProperty";
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor) throw Error("Expected metadata descriptor");
      Object.defineProperty(target, key, { ...descriptor, value: undefined });
      expect(() => checkpoint.restore()).toThrow(
        change === "lazy-method"
          ? "Checkpoint object internal methods changed"
          : "Checkpoint arguments metadata changed",
      );
      expect(readString("JSON.stringify([extra.value, readParameter()])")).toBe("[2,3]");
      Object.defineProperty(target, key, descriptor);
      checkpoint.restore();
      expect(readString("JSON.stringify([extra.value, readParameter()])")).toBe("[1,1]");
      checkpoint.release();
    });
  },
);

it("preserves non-enumerable indices added to empty arguments", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(setups[2]);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("saved")] });
    evaluate(`
      Object.defineProperty(saved, "0", { get() { return 61; }, configurable: true });
      Object.setPrototypeOf(saved, null);
    `);
    expect(readString("JSON.stringify(Reflect.ownKeys(saved).map(key => String(key)))")).toBe(
      '["0","length","callee","Symbol(Symbol.iterator)"]',
    );
    checkpoint.restore();
    expect(readString(observe)).toBe(runInNewContext(setups[2] + observe));
    checkpoint.release();
  });
});

it("rejects arguments in ordinary-only and closed-data checkpoints", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate(setups[0]);
    const argumentsObject = getObject("saved");
    expect(() => api.createOrdinaryObjectCheckpoint([argumentsObject])).toThrow(
      "Checkpoint requires ordinary objects",
    );
    expect(() => api.createDataGraphCheckpoint({ roots: [argumentsObject] })).toThrow(
      "Checkpoint requires ordinary objects",
    );
  });
});
