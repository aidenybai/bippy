import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { withFixture } from "./helpers/engine-fixture.js";

const expressions = [
  ...[
    "Error",
    "EvalError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "TypeError",
    "URIError",
  ].map((name) => `new ${name}("initial", { cause: shared })`),
  'new AggregateError([shared], "initial", { cause: shared })',
  'new SuppressedError(shared, shared, "initial")',
  'new (class extends Error { tag = 5; })("initial", { cause: shared })',
];

const getSetup = (expression: string) => `
  var shared = { payload: 7 };
  var target = ${expression};
  var marker = Symbol("marker");
  var getterCalls = 0;
  Object.defineProperty(target, "probe", {
    get() { getterCalls++; throw Error("unexpected getter"); },
    configurable: true
  });
`;

const observation = `
  JSON.stringify({
    text: Error.prototype.toString.call(target),
    keys: Reflect.ownKeys(target).filter(key => key !== "stack").map(key => String(key)),
    message: Object.getOwnPropertyDescriptor(target, "message"),
    cause: target.cause === shared,
    errors: target.errors && target.errors.map(value => value === shared),
    error: target.error === shared,
    suppressed: target.suppressed === shared,
    alias: target[marker] === target,
    nullPrototype: Object.getPrototypeOf(target) === null,
    frozen: Object.isFrozen(target),
    getterCalls
  });
`;

const branches = [
  `
    target.message = "left";
    target.stack = "branch stack";
    target.cause = shared;
    target[marker] = target;
    Object.preventExtensions(target);
  `,
  `
    delete target.message;
    delete target.stack;
    Object.setPrototypeOf(target, null);
    Object.freeze(target);
  `,
];

for (const expression of expressions) {
  it.each([false, true])(`restores ${expression}, reversed=%s`, async (isReversed) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const setup = getSetup(expression);
      evaluate(setup);
      const target = getObject("target");
      const table = target.properties;
      const baseline = readString(observation);
      const stack = readString("target.stack");
      expect(baseline).toBe(runInNewContext(setup + observation));
      const checkpoint = api.createStateCheckpoint({ objects: [target] });
      try {
        for (const branch of isReversed ? [...branches].reverse() : branches) {
          evaluate(branch);
          expect(readString(observation)).toBe(runInNewContext(setup + branch + observation));
          checkpoint.restore();
          expect(getObject("target")).toBe(target);
          expect(target.properties).toBe(table);
          expect(readString(observation)).toBe(baseline);
          expect(readString("target.stack")).toBe(stack);
        }
      } finally {
        checkpoint.release();
      }
    });
  });
}

const metadataNames = [
  "ErrorData",
  "HostDefinedStack",
  "HostDefinedMessage",
  "HostDefinedFormattedStack",
  "HostDefinedMessageString",
];

it.each(metadataNames)("preflights read-only %s before restoring any properties", async (name) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new Error("initial");
      var extra = { value: 1 };
    `);
    const target = getObject("target");
    const original = Object.getOwnPropertyDescriptor(target, name);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("extra"), target] });
    try {
      evaluate("extra.value = 2");
      Object.defineProperty(target, name, { configurable: true, writable: true, value: "changed" });
      expect(() => checkpoint.restore()).toThrow("Checkpoint error metadata changed");
      expect(readString("JSON.stringify(extra.value)")).toBe("2");
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
      checkpoint.restore();
      expect(readString("JSON.stringify(extra.value)")).toBe("1");
    } finally {
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
      checkpoint.release();
    }
  });
});

it.each(metadataNames)("rejects a %s accessor without invoking it", async (name) => {
  await withFixture(({ api, getObject }) => {
    const target = getObject('new Error("initial")');
    const original = Object.getOwnPropertyDescriptor(target, name);
    let calls = 0;
    Object.defineProperty(target, name, {
      configurable: true,
      get: () => {
        calls++;
        return original?.value;
      },
    });
    try {
      expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
        "Checkpoint error metadata must use data properties",
      );
      expect(calls).toBe(0);
    } finally {
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
    }
  });
});

it.each(["flags", "layout", "methods"])(
  "rejects changed error %s before writes",
  async (change) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      evaluate(`
      var target = new Error("initial");
      var extra = { value: 1 };
    `);
      const target = getObject("target");
      const name =
        change === "flags"
          ? "HostDefinedFormattedStack"
          : change === "layout"
            ? "internalSlotsList"
            : "Get";
      const original = Object.getOwnPropertyDescriptor(target, name);
      const checkpoint = api.createStateCheckpoint({ objects: [getObject("extra"), target] });
      evaluate("extra.value = 2");
      Object.defineProperty(
        target,
        name,
        change === "flags"
          ? { ...original, enumerable: !original?.enumerable }
          : {
              configurable: true,
              value:
                change === "layout"
                  ? [...target.internalSlotsList, "Unexpected"]
                  : () => {
                      throw Error("unexpected method");
                    },
            },
      );
      try {
        expect(() => checkpoint.restore()).toThrow("Checkpoint error metadata changed");
        expect(readString("JSON.stringify(extra.value)")).toBe("2");
        if (original) Object.defineProperty(target, name, original);
        else Reflect.deleteProperty(target, name);
        checkpoint.restore();
        expect(readString("JSON.stringify(extra.value)")).toBe("1");
      } finally {
        if (original) Object.defineProperty(target, name, original);
        else Reflect.deleteProperty(target, name);
        checkpoint.release();
      }
    });
  },
);

it("roots saved diagnostic message values while their slot is detached", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new Error("initial");
      var payload = { value: 7 };
      var reference = new WeakRef(payload);
    `);
    const target = getObject("target");
    Object.defineProperty(target, "HostDefinedMessage", {
      value: [getObject("payload")],
      configurable: true,
      writable: true,
    });
    evaluate("payload = null");
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    Reflect.deleteProperty(target, "HostDefinedMessage");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref().value)")).toBe("7");
    expect(() => checkpoint.restore()).toThrow("Checkpoint error metadata changed");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() === undefined)")).toBe("true");
  });
});

it("does not claim ownership of diagnostic list contents or stack contexts", async () => {
  await withFixture(({ api, getObject }) => {
    const target = getObject('new Error("initial")');
    const stack = Object.getOwnPropertyDescriptor(target, "HostDefinedStack")?.value;
    if (!Array.isArray(stack)) throw Error("Expected stack list");
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    const previous = [...stack];
    expect(previous.length).toBeGreaterThan(0);
    stack.length = 0;
    try {
      checkpoint.restore();
      expect(stack).toEqual([]);
    } finally {
      stack.push(...previous);
      checkpoint.release();
    }
  });
});

it("keeps referenced causes shallow and preserves nested checkpoint order", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(getSetup(expressions[0]));
    const target = getObject("target");
    const outer = api.createStateCheckpoint({ objects: [target] });
    evaluate(`
      target.message = "outer";
      shared.payload = 8;
    `);
    const inner = api.createStateCheckpoint({ objects: [target, getObject("shared")] });
    evaluate(`
      target.message = "inner";
      shared.payload = 9;
    `);
    expect(() => outer.restore()).toThrow("last-in-first-out");
    inner.restore();
    expect(readString("JSON.stringify([target.message, shared.payload])")).toBe('["outer",8]');
    inner.release();
    outer.restore();
    expect(readString("JSON.stringify([target.message, shared.payload])")).toBe('["initial",8]');
    outer.release();
  });
});

it("retains saved causes until release without invoking stack or message getters", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var reference, target;
      (() => {
        const cause = { payload: 7 };
        reference = new WeakRef(cause);
        target = new Error("initial", { cause });
      })();
      Object.defineProperty(target, "stack", { get() { throw Error("stack getter"); }, configurable: true });
      Object.defineProperty(target, "message", { get() { throw Error("message getter"); }, configurable: true });
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
    evaluate("delete target.cause");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref().payload)")).toBe("7");
    checkpoint.restore();
    expect(readString("JSON.stringify(reference.deref() === target.cause)")).toBe("true");
    evaluate("delete target.cause");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() === undefined)")).toBe("true");
  });
});

it("rejects unfinished diagnostics and keeps ordinary-only, closed-data and private-state restrictions", async () => {
  await withFixture(({ api, getObject }) => {
    const target = getObject('new Error("initial")');
    expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow(
      "Checkpoint requires ordinary objects",
    );
    expect(() => api.createDataGraphCheckpoint({ roots: [target] })).toThrow(
      "Checkpoint requires ordinary objects",
    );
    const privateTarget = getObject('new (class extends Error { #value = 1; })("private")');
    expect(() => api.createStateCheckpoint({ objects: [privateTarget] })).toThrow(
      "Checkpoint requires ordinary objects",
    );
    const descriptor = Object.getOwnPropertyDescriptor(target, "HostDefinedFormattedStack");
    if (!descriptor) throw Error("Expected stack metadata");
    Reflect.deleteProperty(target, "HostDefinedFormattedStack");
    try {
      expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
        "Checkpoint requires initialized error metadata",
      );
    } finally {
      Object.defineProperty(target, "HostDefinedFormattedStack", descriptor);
    }
  });
});

it.each([false, true])(
  "forks caught error properties without prefix replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      const setup = `
      var target;
      try { throw new TypeError("initial", { cause: { payload: 7 } }); }
      catch (error) { target = error; }
    `;
      evaluate(setup);
      createBoolean("enabled");
      const target = realm.GlobalObject.properties.get("target")?.Value;
      if (!(target instanceof api.ObjectValue)) throw Error("Expected target");
      let prefixCount = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixCount++;
      };
      const source = `
      void 1;
      try {
        if (enabled) {
          target.message = "left";
          target.stack = "left stack";
          throw target;
        }
        target.message = "right";
      } catch (error) {
        if (error !== target) throw Error("identity changed");
      } finally {
        target.finished = true;
      }
      JSON.stringify([target.message, target.cause.payload, target.finished]);
    `;
      agent.evaluate(compile(source), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      let storage: StateCheckpoint | undefined;
      const checkpoint = agent.captureEvaluation({
        capture: () => {
          const state = api.createStateCheckpoint({ objects: [target] });
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
          expect(completion.Value.stringValue()).toBe(runInNewContext(setup + source, { enabled }));
        }
      } finally {
        checkpoint.release();
        storage?.release();
      }
      expect(prefixCount).toBe(1);
    });
  },
);
