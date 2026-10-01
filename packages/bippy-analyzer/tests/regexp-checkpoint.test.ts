import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { withFixture } from "./helpers/engine-fixture.js";

interface RegexpCase {
  expression: string;
  input: string;
  startIndex?: number;
}

const cases: RegexpCase[] = [
  { expression: "/a/g", input: "baaa" },
  { expression: "/(?<letter>a)(b)?/dg", input: "ab a" },
  { expression: "/(?<=a)b/y", input: "ababb" },
  { expression: "/[😀a]+/gu", input: "😀aa", startIndex: 2 },
  { expression: String.raw`/[\p{ASCII}&&\p{Letter}]+/v`, input: "éabc1" },
  { expression: "/(a+)+b/g", input: "aaab aaac" },
  { expression: "/^a.*$/ms", input: "a\nb\nc" },
  { expression: "/()/gu", input: "😀a", startIndex: 2 },
];

const getSetup = ({ expression, input, startIndex = 1 }: RegexpCase) => `
  var target = ${expression};
  var input = ${JSON.stringify(input)};
  var startIndex = ${startIndex};
  var marker = Symbol("marker");
  var getSource = Object.getOwnPropertyDescriptor(RegExp.prototype, "source").get;
  var getterCalls = 0;
  Object.defineProperty(target, "probe", {
    get() { getterCalls++; throw Error("unexpected getter"); },
    configurable: true
  });
`;

const observation = `
  JSON.stringify({
    source: getSource.call(target),
    lastIndex: Object.getOwnPropertyDescriptor(target, "lastIndex"),
    results: target.results,
    replacement: target.replacement,
    alias: target[marker] === target,
    keys: Reflect.ownKeys(target).map(key => String(key)),
    nullPrototype: Object.getPrototypeOf(target) === null,
    frozen: Object.isFrozen(target),
    getterCalls
  });
`;

const branches = [
  `
    target.lastIndex = startIndex;
    target.results = [];
    for (var index = 0; index < 3; index++) {
      const match = RegExp.prototype.exec.call(target, input);
      target.results.push(match && { entries: Array.from(match), index: match.index, groups: match.groups, indices: match.indices });
    }
    target[marker] = target;
    Object.preventExtensions(target);
  `,
  `
    target.replacement = input.replace(target, "<$&>");
    Object.setPrototypeOf(target, null);
    Object.freeze(target);
  `,
];

for (const entry of cases) {
  it.each([false, true])(
    `restores ${entry.expression} without recompiling, reversed=%s`,
    async (isReversed) => {
      await withFixture(({ api, evaluate, getObject, readString }) => {
        const setup = getSetup(entry);
        evaluate(setup);
        const target = getObject("target");
        const table = target.properties;
        const matcher = Object.getOwnPropertyDescriptor(target, "RegExpMatcher")?.value;
        const baseline = readString(observation);
        expect(baseline).toBe(runInNewContext(setup + observation));
        const checkpoint = api.createStateCheckpoint({ objects: [target] });
        try {
          for (const branch of isReversed ? [...branches].reverse() : branches) {
            evaluate(branch);
            expect(readString(observation)).toBe(runInNewContext(setup + branch + observation));
            checkpoint.restore();
            expect(getObject("target")).toBe(target);
            expect(target.properties).toBe(table);
            expect(Object.getOwnPropertyDescriptor(target, "RegExpMatcher")?.value).toBe(matcher);
            expect(readString(observation)).toBe(baseline);
          }
        } finally {
          checkpoint.release();
        }
      });
    },
  );
}

const metadataNames = [
  "RegExpMatcher",
  "OriginalSource",
  "OriginalFlags",
  "RegExpRecord",
  "parsedPattern",
];

it.each(metadataNames)("preflights read-only %s before any writes", async (name) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = /a/g;
      var extra = { value: 1 };
    `);
    const target = getObject("target");
    const original = Object.getOwnPropertyDescriptor(target, name);
    if (!original) throw Error("Expected regexp metadata");
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("extra"), target] });
    try {
      evaluate("extra.value = 2");
      Object.defineProperty(target, name, { ...original, value: "changed" });
      expect(() => checkpoint.restore()).toThrow("Checkpoint regexp metadata changed");
      expect(readString("JSON.stringify(extra.value)")).toBe("2");
      Object.defineProperty(target, name, original);
      checkpoint.restore();
      expect(readString("JSON.stringify(extra.value)")).toBe("1");
    } finally {
      Object.defineProperty(target, name, original);
      checkpoint.release();
    }
  });
});

it.each(metadataNames)("rejects a %s metadata accessor without invoking it", async (name) => {
  await withFixture(({ api, getObject }) => {
    const target = getObject("/a/g");
    const original = Object.getOwnPropertyDescriptor(target, name);
    if (!original) throw Error("Expected regexp metadata");
    let calls = 0;
    Object.defineProperty(target, name, {
      configurable: true,
      get: () => {
        calls++;
        return original.value;
      },
    });
    try {
      expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
        "Checkpoint regexp metadata must use data properties",
      );
      expect(calls).toBe(0);
    } finally {
      Object.defineProperty(target, name, original);
    }
  });
});

it("keeps matcher-record contents outside selected property ownership", async () => {
  await withFixture(({ api, getObject }) => {
    const target = getObject("/a/g");
    const record = Object.getOwnPropertyDescriptor(target, "RegExpRecord")?.value;
    if (!record || typeof record !== "object") throw Error("Expected regexp record");
    const original = Object.getOwnPropertyDescriptor(record, "IgnoreCase");
    if (!original) throw Error("Expected case flag");
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    Object.defineProperty(record, "IgnoreCase", { ...original, value: true });
    try {
      checkpoint.restore();
      expect(Object.getOwnPropertyDescriptor(record, "IgnoreCase")?.value).toBe(true);
    } finally {
      Object.defineProperty(record, "IgnoreCase", original);
      checkpoint.release();
    }
  });
});

it.each(["flags", "layout", "methods"])("preflights changed regexp %s", async (change) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = /a/g;
      var extra = { value: 1 };
    `);
    const target = getObject("target");
    const name =
      change === "flags" ? "OriginalFlags" : change === "layout" ? "internalSlotsList" : "Get";
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
      expect(() => checkpoint.restore()).toThrow("Checkpoint regexp metadata changed");
      expect(readString("JSON.stringify(extra.value)")).toBe("2");
    } finally {
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
      checkpoint.release();
    }
  });
});

it("restores after matching throws on frozen lastIndex", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = /a/g;
      var caught = false;
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
    evaluate(`
      Object.freeze(target);
      try { target.exec("a"); } catch (error) { caught = error instanceof TypeError; }
    `);
    expect(readString("JSON.stringify(caught)")).toBe("true");
    checkpoint.restore();
    expect(readString('JSON.stringify([target.exec("a")[0], target.lastIndex])')).toBe('["a",1]');
    checkpoint.release();
  });
});

it("retains saved lastIndex values until release and preserves nested order", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = /a/g;
      var reference;
      (() => {
        const position = { valueOf() { return 1; } };
        reference = new WeakRef(position);
        target.lastIndex = position;
      })();
    `);
    const target = getObject("target");
    const outer = api.createStateCheckpoint({ objects: [target] });
    evaluate("target.lastIndex = 2");
    const inner = api.createStateCheckpoint({ objects: [target] });
    expect(() => outer.restore()).toThrow("last-in-first-out");
    evaluate("target.lastIndex = 3");
    inner.restore();
    expect(readString("JSON.stringify(target.lastIndex)")).toBe("2");
    inner.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() !== undefined)")).toBe("true");
    outer.restore();
    expect(readString("JSON.stringify(target.lastIndex === reference.deref())")).toBe("true");
    evaluate("target.lastIndex = 0");
    outer.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() === undefined)")).toBe("true");
  });
});

it("keeps ordinary-only, closed-data, private-state and incomplete-metadata restrictions", async () => {
  await withFixture(({ api, getObject }) => {
    const target = getObject("/a/g");
    expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow(
      "Checkpoint requires ordinary objects",
    );
    expect(() => api.createDataGraphCheckpoint({ roots: [target] })).toThrow(
      "Checkpoint requires ordinary objects",
    );
    const privateTarget = getObject('new (class extends RegExp { #value = 1; })("a", "g")');
    expect(() => api.createStateCheckpoint({ objects: [privateTarget] })).toThrow(
      "Checkpoint requires ordinary objects",
    );
    const descriptor = Object.getOwnPropertyDescriptor(target, "RegExpMatcher");
    if (!descriptor) throw Error("Expected matcher");
    Reflect.deleteProperty(target, "RegExpMatcher");
    try {
      expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
        "Checkpoint requires initialized regexp metadata",
      );
    } finally {
      Object.defineProperty(target, "RegExpMatcher", descriptor);
    }
  });
});

it.each([false, true])(
  "forks RegExp lastIndex without prefix replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      const setup = "var target = /a/g;";
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
      if (enabled) { target.lastIndex = 2; }
      else { target.lastIndex = 0; }
      JSON.stringify([target.exec("baaa").index, target.lastIndex]);
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
