import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { ScriptSyntaxRegion } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const getSyntaxValues = (root: object) => {
  const values = new Set<object>();
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (!value || values.has(value)) continue;
    values.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const child: unknown = descriptor?.get ?? descriptor?.value;
      if (child && (typeof child === "object" || typeof child === "function")) pending.push(child);
    }
  }
  return [...values];
};

it.each([
  "let [first, ...rest] = [1, 2, 3]; ({first} = {first: 4}); JSON.stringify([first, rest]);",
  "const read = ({value = 3} = {}) => value; JSON.stringify([read(), read({value: 5})]);",
  "class Reader { #value = 7; read() { return this.#value; } } JSON.stringify(new Reader().read());",
  "function* values() { yield 2; return 3; } const iterator = values(); JSON.stringify([iterator.next(), iterator.next()]);",
  "const tag = (parts, value) => [parts.raw, value]; JSON.stringify(tag`before${7}after`);",
  "let total = 0; for (const value of [1, 2]) { try { total += value; } finally { total++; } } JSON.stringify(total);",
  "async function read(value) { return await value; } JSON.stringify([read.name, read.length]);",
  'const value = {nested: {count: 3}}; JSON.stringify([value?.nested?.count, /a+/u.test("aaa"), null ?? 4]);',
])("preserves concrete execution while validating tracked syntax: %s", async (program) => {
  await withAbstractFixture(({ api, agent, realm }) => {
    agent.hostDefinedOptions.scriptSyntax = {};
    const regions = new Set<ScriptSyntaxRegion>();
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      const region = api.getScriptSyntaxRegion(node);
      if (region) regions.add(region);
    };
    const result = api.EnsureCompletion(realm.evaluateScriptSkipDebugger(program));
    expect(result.Type).toBe("normal");
    if (!(result.Value instanceof api.JSStringValue)) throw new Error("Expected serialized result");
    expect(result.Value.stringValue()).toBe(runInNewContext(program));
    expect(regions.size).toBe(1);
    for (const region of regions) region.validate();
  });
});

const source =
  "function combine(value, tail) { return value + tail; } combine((true ? 1 : 2), 10);";

it("tracks original nodes, lists, parent cycles, positions, and source accessors without freezing", async () => {
  await withAbstractFixture(({ api, agent, realm }) => {
    agent.hostDefinedOptions.scriptSyntax = {};
    const script = api.ParseScript(source, realm);
    if (Array.isArray(script)) throw new Error("Expected script");
    const root = script.ECMAScriptCode;
    const region = api.getScriptSyntaxRegion(root);
    if (!region) throw new Error("Missing syntax region");
    const values = getSyntaxValues(root);
    expect(values.length).toBe(region.recordCount);
    for (const value of values) expect(api.getScriptSyntaxRegion(value)).toBe(region);
    expect(region.scope).toBe("read-only-parsed-script-syntax-v1");
    expect(region.entryCount).toBeGreaterThan(region.recordCount);
    expect(region.root).toBe(root);
    expect(root.sourceText).toBe(source);
    expect(Object.isFrozen(root)).toBe(false);
    expect(Object.isFrozen(region)).toBe(true);
    expect(region.borrowedReferences).toEqual([
      Object.prototype,
      Array.prototype,
      Function.prototype,
      String.prototype,
    ]);
    expect(api.getScriptSyntaxRegion(script)).toBeUndefined();
    expect(api.getScriptSyntaxRegion(Object.freeze({ ...root }))).toBeUndefined();
    expect(api.getScriptSyntaxRegion(region)).toBeUndefined();
    expect(() => region.validate()).not.toThrow();
  });
});

it.each([
  "literal",
  "location",
  "position",
  "list",
  "field",
  "delete",
  "flags",
  "prototype",
  "accessor",
  "function",
  "extensible",
])("rejects changed finalized syntax: %s", async (kind) => {
  await withAbstractFixture(({ api, agent, realm }) => {
    agent.hostDefinedOptions.scriptSyntax = {};
    const script = api.ParseScript(source, realm);
    if (Array.isArray(script)) throw new Error("Expected script");
    const root = script.ECMAScriptCode;
    const region = api.getScriptSyntaxRegion(root);
    if (!region) throw new Error("Missing syntax region");
    const values = getSyntaxValues(root);
    const numeric = values.find(
      (value) => Object.getOwnPropertyDescriptor(value, "type")?.value === "NumericLiteral",
    );
    const list = values.find((value) => Array.isArray(value) && Object.hasOwn(value, "location"));
    if (!numeric || !list) throw new Error("Missing syntax members");
    let reads = 0;
    if (kind === "literal") Reflect.set(numeric, "value", 100);
    if (kind === "location") Reflect.set(root.location, "startIndex", 1);
    if (kind === "position") Reflect.set(root.location.start, "line", 42);
    if (kind === "list") Reflect.set(list, "length", 0);
    if (kind === "field") Reflect.set(numeric, "extra", true);
    if (kind === "delete") Reflect.deleteProperty(numeric, "value");
    if (kind === "flags") Object.defineProperty(numeric, "value", { writable: false });
    if (kind === "prototype") Object.setPrototypeOf(numeric, null);
    if (kind === "accessor")
      Object.defineProperty(numeric, "value", {
        get: () => {
          reads++;
          return 7;
        },
      });
    if (kind === "function") {
      const getter = Object.getOwnPropertyDescriptor(root, "sourceText")?.get;
      if (!getter) throw new Error("Missing source getter");
      Reflect.set(getter, "extra", true);
    }
    if (kind === "extensible") Object.preventExtensions(numeric);
    expect(() => region.validate()).toThrow("Read-only script syntax changed");
    expect(reads).toBe(0);
  });
});

it("validates the parser source projection retained by root getters, not the whole Parser", async () => {
  await withAbstractFixture(({ api, agent, realm }) => {
    agent.hostDefinedOptions.scriptSyntax = {};
    const script = api.ParseScript(source, realm);
    if (Array.isArray(script)) throw new Error("Expected script");
    const root = script.ECMAScriptCode;
    const getter = Object.getOwnPropertyDescriptor(root, "sourceText")?.get;
    const parser = api
      .getNativeCaptures(getter)
      ?.bindings.find((binding) => binding.name === "[[ThisValue]]")
      ?.get();
    if (!parser || typeof parser !== "object") throw new Error("Missing parser capture");
    const region = api.getScriptSyntaxRegion(root);
    if (!region) throw new Error("Missing syntax region");
    expect(api.getScriptSyntaxRegion(parser)).toBeUndefined();
    Reflect.set(parser, "extra", true);
    expect(() => region.validate()).not.toThrow();
    Reflect.set(parser, "source", "different");
    expect(root.sourceText).toBe("different");
    expect(() => region.validate()).toThrow("Read-only parser source changed");
  });
});

it("does not register default scripts, direct Parser results, modules, or failed scripts", async () => {
  await withAbstractFixture(({ api, agent, realm }) => {
    const untracked = api.ParseScript(source, realm);
    if (Array.isArray(untracked)) throw new Error("Expected script");
    expect(api.getScriptSyntaxRegion(untracked.ECMAScriptCode)).toBeUndefined();
    agent.hostDefinedOptions.scriptSyntax = {};
    const direct = new api.Parser({ source, trackScriptSyntax: true }).parseScript();
    expect(api.getScriptSyntaxRegion(direct)).toBeUndefined();
    const module = api.ParseModule("export const value = 1;", realm);
    if (Array.isArray(module)) throw new Error("Expected module");
    expect(api.getScriptSyntaxRegion(module.ECMAScriptCode)).toBeUndefined();
    expect(Array.isArray(api.ParseScript("let = ;", realm))).toBe(true);
  });
});

it("rejects foreign Agents and retains validation across separate lookups", async () => {
  await withAbstractFixture(({ api, agent, realm }) => {
    agent.hostDefinedOptions.scriptSyntax = {};
    const script = api.ParseScript(source, realm);
    if (Array.isArray(script)) throw new Error("Expected script");
    const root = script.ECMAScriptCode;
    const region = api.getScriptSyntaxRegion(root);
    if (!region) throw new Error("Missing syntax region");
    const foreign = new api.Agent();
    api.setSurroundingAgent(foreign);
    try {
      expect(() => api.getScriptSyntaxRegion(root)).toThrow(
        "Script syntax belongs to another agent",
      );
      expect(() => region.validate()).toThrow("Script syntax belongs to another agent");
    } finally {
      api.setSurroundingAgent(agent);
    }
    expect(api.getScriptSyntaxRegion(root)).toBe(region);
    expect(() => region.validate()).not.toThrow();
  });
});

it.each([
  { limits: { maxRecords: 0 }, message: "Script syntax exceeded maxRecords" },
  { limits: { maxEntries: 0 }, message: "Script syntax exceeded maxEntries" },
  { limits: { maxRecords: -1 }, message: "Invalid script syntax maxRecords" },
  { limits: { maxRecords: 1.5 }, message: "Invalid script syntax maxRecords" },
  { limits: { maxRecords: 1000001 }, message: "Invalid script syntax maxRecords" },
  { limits: { maxEntries: Infinity }, message: "Invalid script syntax maxEntries" },
  { limits: { maxEntries: 8000001 }, message: "Invalid script syntax maxEntries" },
])("rejects syntax registration limits: %j", async ({ limits, message }) => {
  await withAbstractFixture(({ api, agent, realm }) => {
    const sourceCount = agent.parsedSources.size;
    agent.hostDefinedOptions.scriptSyntax = limits;
    expect(() => api.ParseScript(source, realm)).toThrow(message);
    expect(agent.parsedSources.size).toBe(sourceCount);
    agent.hostDefinedOptions.scriptSyntax = {};
    const script = api.ParseScript(source, realm);
    if (Array.isArray(script)) throw new Error("Expected script");
    const region = api.getScriptSyntaxRegion(script.ECMAScriptCode);
    if (!region) throw new Error("Missing syntax region");
    expect(region.maxRecords).toBe(100000);
    expect(region.maxEntries).toBe(1000000);
    expect(region.sourceOwnerCount).toBe(1);
    expect(() => region.validate()).not.toThrow();
  });
});
