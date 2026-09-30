import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getCollectedReference } from "./helpers/concrete-gc.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface TemplateCase {
  name: string;
  literal: string;
}

const templates: TemplateCase[] = [
  { name: "empty", literal: "``" },
  { name: "plain", literal: "`same`" },
  { name: "escapes", literal: "`line\\n\\u0061`" },
  { name: "invalid escape", literal: "`\\unicode`" },
  { name: "substitutions", literal: "`head ${++substitutions} middle ${++substitutions} tail`" },
];

const getSetup = (literal: string, raw: boolean): string => `
  var reference, substitutions = 0;
  function tag(strings, ...values) {
    if (!reference) reference = new WeakRef(${raw ? "strings.raw" : "strings"});
    return {
      same: reference.deref() === ${raw ? "strings.raw" : "strings"},
      frozen: Object.isFrozen(strings) && Object.isFrozen(strings.raw),
      cooked: Array.from(strings, value => value === undefined ? null : value),
      raw: Array.from(strings.raw),
      values
    };
  }
  function read() {return tag${literal};}
  read();
`;

it.each(templates.flatMap((template) => [false, true].map((raw) => ({ ...template, raw }))))(
  "retains $name template identity through collection, raw=$raw",
  async ({ literal, raw }) => {
    const setup = getSetup(literal, raw);
    const native = getNativeGcObservation(setup, "JSON.stringify(read())");
    expect(JSON.parse(native)).toMatchObject({ same: true, frozen: true });
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      const map = runtime.realm.TemplateMap;
      const entry = map[0];
      expect(map).toHaveLength(1);
      expect(await getCollectedReference(runtime)).toBe("true");
      expect(runtime.readString("JSON.stringify(read())")).toBe(native);
      expect(runtime.realm.TemplateMap).toBe(map);
      expect(map).toHaveLength(1);
      expect(map[0]).toBe(entry);
      map.length = 0;
      expect(await getCollectedReference(runtime)).toBe("false");
    } finally {
      runtime.dispose();
    }
  },
);

it.each([false, true])(
  "keeps equal-text sites distinct but reuses a shared site, shared=%s",
  async (shared) => {
    const setup = `
    var reference, second;
    function tag(strings) { return strings; }
    ${shared ? "function create() {return () => tag`same`;}; var firstRead = create(), secondRead = create();" : "function firstRead() {return tag`same`;} function secondRead() {return tag`same`;}"}
    reference = new WeakRef(firstRead());
    second = new WeakRef(secondRead());
  `;
    const observation =
      "JSON.stringify([reference.deref() === firstRead(), second.deref() === secondRead(), firstRead() === secondRead()])";
    const native = getNativeGcObservation(setup, observation);
    expect(JSON.parse(native)).toEqual([true, true, shared]);
    const runtime = await createConcreteRuntime();
    try {
      runtime.evaluate(setup);
      expect(await getCollectedReference(runtime)).toBe("true");
      expect(runtime.readString(observation)).toBe(native);
      expect(runtime.realm.TemplateMap).toHaveLength(shared ? 1 : 2);
    } finally {
      runtime.dispose();
    }
  },
);
