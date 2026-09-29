import { constants, createContext, runInContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withFixture } from "./helpers/engine-fixture.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

it("does not own a distinct global receiver or traverse backing values", async () => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const bindingObject = getObject("var backing = { value: 1 }; backing");
    const receiver = getObject("var receiver = { value: 2 }; receiver");
    const environment = new api.GlobalEnvironmentRecord(bindingObject, receiver);
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    expect(checkpoint.objectCount).toBe(1);
    try {
      evaluate("backing.value = 3; receiver.value = 4;");
      checkpoint.restore();
      expect(environment.GetThisBinding() === receiver).toBe(true);
      expect(readString("JSON.stringify([backing.value, receiver.value])")).toBe("[1,4]");
    } finally {
      checkpoint.release();
    }
  });
});

it("rejects disposal and debugger preview before changing selected global state", async () => {
  await withFixture(({ api, realm, evaluate, readString }) => {
    evaluate("var count = 1; let lexical = 2;");
    const environment = realm.GlobalEnv;
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    try {
      evaluate("count = 3; lexical = 4;");
      const resources = environment.DeclarativeRecord.DisposableResourceStack;
      api.X(api.AddDisposableResource(resources, api.Value.undefined, "async-dispose"));
      expect(() => checkpoint.restore()).toThrow("pending disposal");
      expect(() => api.createStateCheckpoint({ environments: [environment] })).toThrow(
        "pending disposal",
      );
      expect(readString("JSON.stringify([count, lexical])")).toBe("[3,4]");
      resources.pop();
      api.surroundingAgent.debugger_scopePreview(() => {
        expect(() => checkpoint.restore()).toThrow("during preview");
      });
      expect(readString("JSON.stringify([count, lexical])")).toBe("[3,4]");
      checkpoint.restore();
      expect(readString("JSON.stringify([count, lexical])")).toBe("[1,2]");
    } finally {
      checkpoint.release();
    }
  });
});

it("rejects proxy backing storage without invoking guest traps or registering a frame", async () => {
  await withFixture(({ api, realm, getObject, readString }) => {
    const proxy = getObject(`
      var traps = 0;
      new Proxy({}, {
        ownKeys() {
          traps++;
          throw Error("trap");
        },
      })
    `);
    const environment = new api.GlobalEnvironmentRecord(proxy, proxy);
    const parent = api.createStateCheckpoint({ environments: [realm.GlobalEnv] });
    try {
      expect(() => api.createStateCheckpoint({ environments: [environment] })).toThrow(
        "Checkpoint requires",
      );
      expect(readString("String(traps)")).toBe("0");
      parent.restore();
    } finally {
      parent.release();
    }
  });
});

const setup = `
  var count = 1;
  let lexical = 2;
  const stable = { value: 3 };
  var alias = stable;
  function read() {
    return [count, lexical, stable.value];
  }
`;
const observation = `JSON.stringify([
  read(),
  stable === alias,
  typeof branchLexical,
  typeof branchFunction,
  Object.hasOwn(globalThis, "branchVar"),
  Object.getOwnPropertyDescriptor(globalThis, "count").writable,
])`;

it.each([false, true])(
  "restores global property and lexical bindings, reversed=%s",
  async (isReversed) => {
    await withFixture(({ api, realm, evaluate, readString }) => {
      evaluate(setup);
      const environment = realm.GlobalEnv;
      const globalObject = realm.GlobalObject;
      const bindings = environment.DeclarativeRecord.bindings;
      const lexical = bindings.get("lexical");
      const properties = globalObject.properties;
      const checkpoint = api.createStateCheckpoint({
        objects: [globalObject],
        environments: [environment, environment, environment.DeclarativeRecord],
      });
      expect([
        checkpoint.objectCount,
        checkpoint.environmentCount,
        checkpoint.bindingCount,
      ]).toEqual([1, 2, 2]);
      const baseline = readString(observation);
      const actions = [
        `
          count = 4;
          lexical = 5;
          var branchVar = 6;
          let branchLexical = 7;
          function branchFunction() {
            return 23;
          }
          read = () => [count, lexical, 42];
          Object.defineProperty(globalThis, "count", { writable: false });
        `,
        `
          count = 8;
          lexical = 9;
          var branchVar = 10;
          let branchLexical = 11;
          function branchFunction() {
            return 24;
          }
          Object.defineProperty(globalThis, "branchAccessor", {
            get() {
              throw Error("getter must not run");
            },
          });
        `,
      ];
      try {
        for (const action of isReversed ? [...actions].reverse() : actions) {
          const native = createContext(constants.DONT_CONTEXTIFY);
          runInContext(setup, native);
          expect(baseline).toBe(runInContext(observation, native));
          runInContext(action, native);
          evaluate(action);
          expect(readString(observation)).toBe(runInContext(observation, native));
          checkpoint.restore();
          expect(environment.DeclarativeRecord.bindings === bindings).toBe(true);
          expect(bindings.get("lexical") === lexical).toBe(true);
          expect(globalObject.properties === properties).toBe(true);
          expect(readString(observation)).toBe(baseline);
          expect(globalObject.properties.has("branchAccessor")).toBe(false);
        }
      } finally {
        checkpoint.release();
      }
    });
  },
);

it.each([false, true])(
  "forks global bindings without prefix replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      const initial = `
      var count = 1;
      let lexical = 2;
      var read = () => [count, lexical];
    `;
      evaluate(initial);
      createBoolean("enabled");
      let prefixes = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      const source = `
      void 1;
      if (enabled) {
        count += 3;
        lexical += 4;
        globalThis.branch = 5;
      } else {
        count -= 2;
        lexical -= 3;
      }
      JSON.stringify([read(), Object.hasOwn(globalThis, "branch")]);
    `;
      agent.evaluate(compile(source), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      let storage: StateCheckpoint | undefined;
      const checkpoint = agent.captureEvaluation({
        capture: () => {
          const state = api.createStateCheckpoint({ environments: [realm.GlobalEnv] });
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
        for (const choice of isReversed ? [true, false] : [false, true]) {
          checkpoint.restore();
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          const result = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: choice,
            },
          });
          if (!result.done) throw Error("Expected completion");
          const completion = api.EnsureCompletion(result.value);
          if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected observation");
          const native = createContext(constants.DONT_CONTEXTIFY);
          native.enabled = choice;
          runInContext(initial, native);
          expect(completion.Value.stringValue()).toBe(runInContext(source, native));
        }
      } finally {
        checkpoint.release();
        storage?.release();
      }
      expect(prefixes).toBe(1);
    });
  },
);

it("keeps global backing selection shallow and restores nested checkpoints", async () => {
  await withFixture(({ api, realm, evaluate, readString }) => {
    evaluate(setup);
    const parent = api.createStateCheckpoint({ environments: [realm.GlobalEnv] });
    evaluate(`
      count = 4;
      lexical = 5;
      stable.value = 6;
    `);
    const child = api.createStateCheckpoint({ environments: [realm.GlobalEnv] });
    evaluate("count = 7; lexical = 8;");
    expect(() => parent.restore()).toThrow("last-in-first-out");
    child.restore();
    expect(readString("JSON.stringify(read())")).toBe("[4,5,6]");
    child.release();
    parent.restore();
    expect(readString("JSON.stringify(read())")).toBe("[1,2,6]");
    parent.release();
    expect(() => parent.restore()).toThrow("released");
  });
});

it.each(["ObjectRecord", "DeclarativeRecord", "GlobalThisValue", "BindingObject"])(
  "preflights changed global %s before any selected writes",
  async (name) => {
    await withFixture(({ api, realm, evaluate, getObject, readString }) => {
      evaluate("var count = 1; let lexical = 2; var extra = { value: 3 };");
      const environment = realm.GlobalEnv;
      const target = name === "BindingObject" ? environment.ObjectRecord : environment;
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (!descriptor) throw Error("Expected metadata");
      const replacement =
        name === "ObjectRecord"
          ? new api.ObjectEnvironmentRecord(getObject("({})"), false, null)
          : name === "DeclarativeRecord"
            ? new api.DeclarativeEnvironmentRecord(null)
            : getObject("({})");
      const checkpoint = api.createStateCheckpoint({
        objects: [getObject("extra")],
        environments: [environment],
      });
      try {
        evaluate("count = 4; lexical = 5; extra.value = 6;");
        Reflect.set(target, name, replacement);
        expect(() => checkpoint.restore()).toThrow(
          "Checkpoint global environment metadata changed",
        );
        Object.defineProperty(target, name, descriptor);
        expect(readString("JSON.stringify([count, lexical, extra.value])")).toBe("[4,5,6]");
        checkpoint.restore();
        expect(readString("JSON.stringify([count, lexical, extra.value])")).toBe("[1,2,3]");
      } finally {
        Object.defineProperty(target, name, descriptor);
        checkpoint.release();
      }
    });
  },
);

it.each(["with", "outer", "declarative-outer", "object-outer"])(
  "rejects changed global shape: %s",
  async (mode) => {
    await withFixture(({ api, realm }) => {
      const environment = realm.GlobalEnv;
      const target =
        mode === "declarative-outer"
          ? environment.DeclarativeRecord
          : mode === "outer"
            ? environment
            : environment.ObjectRecord;
      const name = mode === "with" ? "IsWithEnvironment" : "OuterEnv";
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (!descriptor) throw Error("Expected metadata");
      const checkpoint = api.createStateCheckpoint({ environments: [environment] });
      try {
        Reflect.set(
          target,
          name,
          mode === "with" ? true : new api.DeclarativeEnvironmentRecord(null),
        );
        expect(() => checkpoint.restore()).toThrow(
          "Checkpoint requires a canonical global environment",
        );
        expect(() => api.createStateCheckpoint({ environments: [environment] })).toThrow(
          "Checkpoint requires a canonical global environment",
        );
        Object.defineProperty(target, name, descriptor);
        checkpoint.restore();
      } finally {
        Object.defineProperty(target, name, descriptor);
        checkpoint.release();
      }
    });
  },
);

it("captures global environments from two realms of one Agent", async () => {
  await withFixture(({ api, realm }) => {
    const other = new api.ManagedRealm();
    for (const current of [realm, other]) {
      api.X(
        api.EnsureCompletion(current.evaluateScriptSkipDebugger("var count = 1; let lexical = 2;")),
      );
    }
    const checkpoint = api.createStateCheckpoint({
      environments: [realm.GlobalEnv, other.GlobalEnv],
    });
    expect([checkpoint.objectCount, checkpoint.environmentCount]).toEqual([2, 4]);
    try {
      for (const current of [realm, other])
        current.evaluateScriptSkipDebugger("count = 3; lexical = 4;");
      checkpoint.restore();
      for (const current of [realm, other]) {
        const result = api.EnsureCompletion(current.evaluateScriptSkipDebugger("count + lexical"));
        expect(result.Value).toEqual(api.Value(3));
      }
    } finally {
      checkpoint.release();
    }
  });
});

it.each(["global", "object", "declarative", "receiver"])(
  "rejects foreign global %s state",
  async (selected) => {
    await withFixture(({ api, realm }) => {
      const agent = api.surroundingAgent;
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      const foreign = new api.ManagedRealm();
      api.setSurroundingAgent(agent);
      const environment = realm.GlobalEnv;
      const name =
        selected === "object"
          ? "ObjectRecord"
          : selected === "declarative"
            ? "DeclarativeRecord"
            : "GlobalThisValue";
      const descriptor = Object.getOwnPropertyDescriptor(environment, name);
      if (!descriptor) throw Error("Expected metadata");
      const parent = api.createStateCheckpoint({ environments: [environment] });
      try {
        if (selected !== "global")
          Reflect.set(environment, name, Reflect.get(foreign.GlobalEnv, name));
        expect(() =>
          api.createStateCheckpoint({
            environments: [selected === "global" ? foreign.GlobalEnv : environment],
          }),
        ).toThrow(
          selected === "receiver"
            ? "Checkpoint global receiver must belong to the current agent"
            : "Checkpoint environments must belong to the current agent",
        );
        Object.defineProperty(environment, name, descriptor);
        parent.restore();
      } finally {
        Object.defineProperty(environment, name, descriptor);
        parent.release();
      }
    });
  },
);

it("restores declaration initialization and saved global roots", async () => {
  await withFixture(({ api, realm, evaluate, readString }) => {
    evaluate(`
      var reference;
      let retained = (() => {
        const held = {};
        reference = new WeakRef(held);
        return held;
      })();
    `);
    const environment = realm.GlobalEnv;
    api.X(environment.DeclarativeRecord.CreateMutableBinding("uninitialized", false));
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    evaluate("retained = null;");
    api.X(environment.DeclarativeRecord.InitializeBinding("uninitialized", api.Value(7)));
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() !== undefined)")).toBe("true");
    checkpoint.restore();
    expect(environment.DeclarativeRecord.bindings.get("uninitialized")?.initialized).toBe(false);
    expect(readString("String(retained === reference.deref())")).toBe("true");
    evaluate("retained = null;");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() !== undefined)")).toBe("false");
  });
});
