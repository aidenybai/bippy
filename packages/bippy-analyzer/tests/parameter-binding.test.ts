import * as published from "@engine262/engine262";
import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";

const programs = [
  `
    function collect() {
      function value() {
        return 1;
      }
      function value() {
        return 2;
      }
      var value;
      return value();
    }
    return collect();
  `,
  `
    function collect() {
      let [first, { value: second }] = [1, { value: 2 }];
      const third = 3;
      class Fourth {
        static value = 4;
      }
      return [first, second, third, Fourth.value];
    }
    return collect();
  `,
  `
    const trace = [];
    const spread = {
      *[Symbol.iterator]() {
        trace.push("spread");
        yield 2;
        yield 3;
      },
    };
    function collect(...values) {
      trace.push("call");
      return values;
    }
    const values = collect(
      (trace.push("first"), 1),
      ...spread,
      (trace.push("last"), 4)
    );
    return [values, trace];
  `,
  `
    const trace = [];
    const spread = {
      *[Symbol.iterator]() {
        try {
          yield 1;
          throw Error("spread");
        } finally {
          trace.push("close");
        }
      },
    };
    try {
      ((...values) => trace.push("call"))(...spread, (trace.push("last"), 2));
    } catch (error) {
      trace.push(error.message);
    }
    return trace;
  `,
  `
    const trace = [];
    let previous;
    function tag(site, ...values) {
      const same = previous === site;
      previous = site;
      return [same, site.raw, values];
    }
    function render() {
      return tag\`first\${(trace.push(1), 1)}last\${(trace.push(2), 2)}\`;
    }
    return [render(), render(), trace];
  `,
  `
    const trace = [];
    function resource(name) {
      return {
        [Symbol.dispose]() {
          trace.push(name);
        },
      };
    }
    function collect() {
      using first = resource("first"), second = resource("second");
      return 7;
    }
    return [collect(), trace];
  `,
  `
    const trace = [];
    function resource(name) {
      return {
        [Symbol.dispose]() {
          trace.push(name);
          throw Error(name);
        },
      };
    }
    try {
      using first = resource("first"), second = resource("second");
      throw Error("body");
    } catch (error) {
      return [
        trace,
        error.name,
        error.error.message,
        error.suppressed.name,
        error.suppressed.error.message,
        error.suppressed.suppressed.message,
      ];
    }
  `,
  `
    const trace = [];
    const resource = {
      [Symbol.dispose]() {
        trace.push("dispose");
      },
    };
    try {
      using first = resource, second = (() => {
        throw Error("initialize");
      })();
    } catch (error) {
      trace.push(error.message);
    }
    return trace;
  `,
  `
    function collect(first, second = arguments[0]) {
      return [first, second];
    }
    return [collect(7), collect(8, 9)];
  `,
  `
    function collect(first, { [arguments[0]]: value } = { key: 13 }) {
      return value;
    }
    return collect("key");
  `,
  `
    function collect(first, second = eval("arg" + "uments[0]")) {
      return [first, second];
    }
    return collect(7);
  `,
  String.raw`function collect(value) { return arg\u0075ments[0]; } return collect(7);`,
  String.raw`function collect(value) { return e\u0076al('arg' + 'uments[0]'); } return collect(7);`,
  `
    function collect(value) {
      return () => eval("arg" + "uments[0]");
    }
    return collect(7)();
  `,
  `
    function collect(value) {
      "use strict";
      return eval("typeof arg" + "uments");
    }
    return collect(7);
  `,
  `
    function collect(run) {
      with ({ run }) {
        return run("typeof arg" + "uments");
      }
    }
    return collect(eval);
  `,
  `
    function collect(value) {
      if (value === 0) return () => value;
      const child = collect(value - 1);
      return () => [value, child()];
    }
    return collect(3)();
  `,
  `
    function* collect(value) {
      yield value;
      yield value + 1;
    }
    return [...collect(7)];
  `,
  `
    function collect(value) {
      const saved = arguments;
      value = 9;
      return [saved, () => value];
    }
    const [saved, get] = collect(2);
    saved[0] = 7;
    return [saved[0], get()];
  `,
  `
    function collect(value) {
      eval("value = 9");
      return arguments;
    }
    const saved = collect(2);
    return [saved[0], Object.getOwnPropertyDescriptor(saved, "0").value];
  `,
  `
    function collect(value) {
      Object.defineProperty(arguments, "0", {
        get() {
          return 8;
        },
      });
      value = 9;
      return [value, arguments[0]];
    }
    return collect(2);
  `,
  `
    function collect(first, second) {
      return [first, second, arguments.length, [...arguments]];
    }
    return [collect(), collect(1), collect(1, 2, 3)];
  `,
  `
    function collect(first, first) {
      first = 4;
      return [first, arguments[0], arguments[1]];
    }
    return [collect(), collect(1), collect(1, 2)];
  `,
  `
    function collect(first, second) {
      first = 4;
      arguments[1] = 5;
      return [first, second, [...arguments]];
    }
    return collect(1, 2);
  `,
  `
    function collect(first, second) {
      "use strict";
      first = 4;
      arguments[1] = 5;
      return [first, second, [...arguments]];
    }
    return collect(1, 2);
  `,
  `
    function collect(first) {
      delete arguments[0];
      first = 4;
      return [first, arguments[0], arguments.length];
    }
    return collect(1);
  `,
  `
    function collect(first) {
      Object.defineProperty(arguments, "0", { value: 7, writable: false });
      first = 4;
      return [first, arguments[0]];
    }
    return collect(1);
  `,
  `
    function collect(arguments) {
      return arguments;
    }
    return collect(9);
  `,
  `
    function collect(first) {
      return eval("[first, arguments[0], arguments.length]");
    }
    return collect(3, 4);
  `,
  `
    function collect(first) {
      return (() => [first, arguments[0], arguments.length])(99);
    }
    return collect(3, 4);
  `,
  `
    function collect(first) {
      const get = () => [first, arguments[0]];
      first = 7;
      return get;
    }
    return collect(1)();
  `,
  `
    function collect(first = 4, second = first + 1) {
      first = 8;
      return [first, second, arguments[0]];
    }
    return [collect(), collect(1)];
  `,
  `
    function collect({ first }, [second], ...rest) {
      return [first, second, rest];
    }
    return collect({ first: 1 }, [2], 3, 4);
  `,
  `
    class Base {
      constructor(first) {
        this.value = first;
      }
    }
    class Child extends Base {
      constructor(first, second) {
        super(first);
        this.other = second;
        this.args = [...arguments];
      }
    }
    return new Child(1, 2);
  `,
  `
    function collect(first) {
      return [first, new.target === collect, arguments[0]];
    }
    return [collect(1), new collect(2)];
  `,
  `
    function collect(first) {
      return first;
    }
    return [
      collect.call(null, 3),
      collect.apply(null, [4]),
      collect.bind(null, 5)(),
    ];
  `,
  "return ((first, second) => [first, second])(...[1, 2]);",
  `
    function* collect(first) {
      yield [first, arguments[0]];
    }
    return [...collect(8)];
  `,
  `
    function collect(first) {
      Object.freeze(arguments);
      first = 9;
      return [first, arguments[0]];
    }
    return collect(2);
  `,
  `
    let calls = 0;
    Object.defineProperty(Object.prototype, "done", {
      configurable: true,
      get() {
        calls++;
        return true;
      },
    });
    function collect(first) {
      return first;
    }
    const result = collect(4);
    delete Object.prototype.done;
    return [result, calls];
  `,
];

const getPublishedObservation = (source: string) => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const result = published.EnsureCompletion(
      new published.ManagedRealm().evaluateScriptSkipDebugger(source),
    );
    expect(result.Type).toBe("normal");
    if (result.Value.type !== "String") throw new Error("Expected a published string observation");
    return result.Value.value;
  } finally {
    published.setSurroundingAgent(previous);
  }
};

const getOptimizedObservation = async (source: string) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(new api.Agent({ startEventLoop: false, elideUnusedArguments: true }));
  try {
    const result = api.EnsureCompletion(new api.ManagedRealm().evaluateScriptSkipDebugger(source));
    expect(result.Type).toBe("normal");
    if (result.Value.type !== "String") throw new Error("Expected an optimized string observation");
    return result.Value.value;
  } finally {
    api.setSurroundingAgent(previous);
  }
};

it.each(programs)("preserves native and published function evaluation: %s", async (program) => {
  const source = `JSON.stringify((() => { ${program} })())`;
  const runtime = await createConcreteRuntime();
  try {
    const observation = runtime.readString(source);
    expect(observation).toBe(await getOptimizedObservation(source));
    expect(observation).toBe(getPublishedObservation(source));
    expect(observation).toBe(createNativeRuntime().evaluate(source));
  } finally {
    runtime.dispose();
  }
});

it.each([false, true])(
  "preserves internal iterator breakpoints with debugger option %s",
  async (withDebugger) => {
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    const agent = new api.Agent({
      startEventLoop: false,
      elideUnusedArguments: true,
      onDebugger: withDebugger ? () => {} : undefined,
    });
    api.setSurroundingAgent(agent);
    try {
      const realm = new api.ManagedRealm();
      const pop = realm.pushTopContext();
      try {
        const nextMethod = agent.intrinsic("%GeneratorFunction.prototype.prototype.next%");
        agent.breakpointsByFunction.add(nextMethod);
        const compiled = realm.compileScript(
          `
            function identity(value) {
              return value;
            }
            identity(7)
          `,
        );
        if (compiled instanceof api.ThrowCompletion)
          throw new Error("Unexpected fixture parse error");
        const record = api.EnsureCompletion(compiled).Value;
        if (!record) throw new Error("Missing fixture script");
        const evaluation = api.ScriptEvaluation(record);
        let pauses = 0;
        let state = evaluation.next({ resume: "debugger", value: undefined });
        while (!state.done) {
          if (state.value.suspend === "debugger") pauses++;
          state = evaluation.next({ resume: "debugger", value: undefined });
        }
        expect(pauses).toBeGreaterThan(0);
        const result = api.EnsureCompletion(state.value);
        expect(result.Type).toBe("normal");
        expect(result.Value.type).toBe("Number");
      } finally {
        pop?.();
      }
    } finally {
      api.setSurroundingAgent(previous);
    }
  },
);
