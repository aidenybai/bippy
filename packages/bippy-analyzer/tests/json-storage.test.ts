import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

const evaluate = async (body: string): Promise<string> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-json-storage-"));
  const entryPath = join(rootDirectory, "entry.ts");
  writeFileSync(entryPath, `export const evaluate = () => { ${body} };`);
  const renderer = await createStaticRenderer({ rootDirectory });
  let result = "";
  await renderer.renderWith((interpreter) => {
    const module = renderer.loadModule(entryPath);
    if (!module) throw new Error("Could not load JSON fixture");
    const context = interpreter.createModuleContext(module);
    result = describeValue(
      interpreter.callValue(
        interpreter.evaluateModuleExport(module, "evaluate"),
        [],
        context,
        null,
      ),
    );
    return UNDEFINED_VALUE;
  });
  return result;
};

describe("symbolic JSON stored by application code", () => {
  it.each([
    { body: "return JSON.stringify(undefined);", expected: "undefined" },
    {
      body: "return JSON.stringify({ value: 1, method: () => 2 });",
      expected: JSON.stringify('{"value":1}'),
    },
    {
      body: "return JSON.stringify([() => 1, Symbol('value')]);",
      expected: JSON.stringify("[null,null]"),
    },
    {
      body: "try { JSON.stringify({ value: 1n }); return 'accepted'; } catch (error) { return error.name; }",
      expected: JSON.stringify("TypeError"),
    },
    {
      body: "const text = Math.random() > 0.5 ? 'true' : '1'; return typeof JSON.parse(text);",
      expected: 'branch("boolean" | "number")',
    },
  ])("preserves upstream JSON behavior: $body", async ({ body, expected }) => {
    expect(await evaluate(body)).toBe(expected);
  });

  it.each(["localStorage", "sessionStorage"])(
    "preserves known seeded data through %s",
    async (storage) => {
      expect(
        await evaluate(`
      const bookmarks = [
        { id: crypto.randomUUID(), title: "Documentation", group: "work" },
        { id: crypto.randomUUID(), title: "Recipes", group: "home" },
      ];
      ${storage}.setItem("bookmarks", JSON.stringify(bookmarks));
      const restored = JSON.parse(${storage}.getItem("bookmarks"));
      return [restored.length, restored[0].title, restored[1].group, typeof restored[0].id];
    `),
      ).toBe('[2, "Documentation", "home", "string"]');
    },
  );

  it("snapshots at serialization and allocates independent objects at every parse", async () => {
    expect(
      await evaluate(`
      const child = { id: crypto.randomUUID(), title: "before" };
      const serialized = JSON.stringify({ first: child, second: child });
      child.title = "source mutation";
      const first = JSON.parse(serialized);
      first.first.title = "parsed mutation";
      const second = JSON.parse(serialized);
      return [first.first.title, first.second.title, second.first.title, first.first === first.second];
    `),
    ).toBe('["parsed mutation", "before", "before", false]');
  });

  it("preserves symbolic string identity without exposing escaped JSON text", async () => {
    expect(
      await evaluate(`
      const identifier = crypto.randomUUID();
      const serialized = JSON.stringify({ identifier });
      return [JSON.parse(serialized).identifier === identifier, typeof serialized, Boolean(serialized)];
    `),
    ).toBe('[true, "string", true]');
  });

  it("keeps ordinary JSON omission, numeric normalization and property semantics", async () => {
    expect(
      await evaluate(`
      const source = { id: crypto.randomUUID(), missing: undefined, callback: () => 1, values: [undefined, () => 1, NaN, Infinity, -0] };
      Object.defineProperty(source, "hidden", { value: 9 });
      const parsed = JSON.parse(JSON.stringify(source));
      return ["missing" in parsed, "callback" in parsed, "hidden" in parsed, parsed.values];
    `),
    ).toBe("[false, false, false, [null, null, null, null, 0]]");
  });

  it("does not attach a serialized payload to a modified string or a reviver call", async () => {
    expect(
      await evaluate(`
      const serialized = JSON.stringify({ id: crypto.randomUUID(), title: "before" });
      return [JSON.parse(serialized + "suffix").title, JSON.parse(serialized, (key, value) => key === "title" ? "after" : value).title];
    `),
    ).not.toContain('"before"');
  });

  it("does not treat arbitrary unknown values as guaranteed JSON properties", async () => {
    expect(
      await evaluate(`
      const parsed = JSON.parse(JSON.stringify({ value: window.unavailableInput }));
      return "value" in parsed;
    `),
    ).not.toBe("true");
  });

  it("keeps conditional property omission and symbolic values correlated", async () => {
    expect(
      await evaluate(`
      const enabled = Math.random() > 0.5;
      const serialized = JSON.stringify({ id: crypto.randomUUID(), value: enabled ? "yes" : undefined });
      const parsed = JSON.parse(serialized);
      return "value" in parsed ? parsed.value : "absent";
    `),
    ).toBe('branch("yes" | "absent")');
  });

  it.each(["1n", "(() => { const value = {}; value.self = value; return value; })()"])(
    "throws for unsupported native JSON input %s",
    async (input) => {
      expect(
        await evaluate(`
      try { JSON.stringify(${input}); return "did not throw"; }
      catch (error) { return error.name; }
    `),
      ).toBe('"TypeError"');
    },
  );

  it("does not claim a definite throw when only one branch is cyclic", async () => {
    expect(
      await evaluate(`
      const source = { id: crypto.randomUUID() };
      source.self = Math.random() > 0.5 ? source : null;
      try { JSON.stringify(source); return "serialized"; }
      catch { return "threw"; }
    `),
    ).toBe('branch("serialized" | "threw")');
  });

  it("keeps non-finite possibilities for an unconstrained numeric leaf", async () => {
    expect(
      await evaluate(`
      const parsed = JSON.parse(JSON.stringify({ value: Number(window.unavailableInput) }));
      return parsed.value === null ? "null" : typeof parsed.value;
    `),
    ).toBe('branch("null" | "number")');
  });

  it("does not assume serialization hooks or getters are plain data", async () => {
    expect(
      await evaluate(`
      const withHook = JSON.parse(JSON.stringify({ id: crypto.randomUUID(), toJSON: () => ({ replaced: true }) }));
      const withGetter = JSON.parse(JSON.stringify({ id: crypto.randomUUID(), get title() { return "getter"; } }));
      return ["id" in withHook, withGetter.title];
    `),
    ).not.toContain("[true,");
  });
});
