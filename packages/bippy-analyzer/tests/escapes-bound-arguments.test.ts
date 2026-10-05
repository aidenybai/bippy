import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { EscapeMemo } from "../src/evaluate/escape-memo.js";
import {
  followStaleCallables,
  forEachEscapedCallable,
  type EscapeWalk,
} from "../src/evaluate/escapes.js";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

interface EscapedCall {
  name: string | null;
  arguments: (string | null)[] | null;
}

const SOURCE = `
const record = (value: string) => {};
const other = (value: string) => {};
const invoke = (callback: (value: string) => void, value: string) => callback(value);
const invokeBoth = (first: typeof record, second: typeof record, value: string) => {
  first(value);
  second(value);
};
const bound = invoke.bind(null, record);
const boundBoth = invokeBoth.bind(null, record);
export const direct = invoke.bind(null, record, "direct");
export const called = () => boundBoth(other, "called");
export const held = { callback: invoke.bind(null, record, "held") };
export const rebound = bound.bind(null, "rebound");
const ignore = (callback: typeof record) => {};
export const unused = ignore.bind(null, record);
const recur = (callback: typeof record) => {
  callback("recursive");
  recursive();
};
export const recursive = recur.bind(null, record);
export const callbacks = { current: record };
const invokeCurrent = (handlers: typeof callbacks, value: string) => handlers.current(value);
export const stale = invokeCurrent.bind(null, callbacks, "stale");
export const replaceCallback = () => { callbacks.current = other; };
`;

const collectEscapedCalls = async (
  exportName: string,
  shouldReplaceCallback = false,
): Promise<EscapedCall[]> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-bound-escapes-"));
  try {
    const entryFile = join(rootDirectory, "module.ts");
    writeFileSync(entryFile, SOURCE);
    const renderer = await createStaticRenderer({ rootDirectory });
    const calls: EscapedCall[] = [];
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(entryFile);
      if (!module) throw new Error(`could not parse ${entryFile}`);
      const exported = interpreter.evaluateModuleExport(module, exportName);
      const walk: EscapeWalk = {
        memo: new EscapeMemo(() => {}),
        resolveModuleBinding: (innerModule, name) =>
          interpreter.evaluateModuleBinding(innerModule, name, null),
        visit: (callable, frame) => {
          calls.push({
            name: callable.name,
            arguments:
              frame?.arguments.map((value) => (value ? describeValue(value) : null)) ?? null,
          });
        },
      };
      forEachEscapedCallable(exported, walk);
      if (shouldReplaceCallback) {
        const callbacks = interpreter.evaluateModuleExport(module, "callbacks");
        if (callbacks.kind !== "object") throw new Error("expected callback container");
        interpreter.callValue(
          interpreter.evaluateModuleExport(module, "replaceCallback"),
          [],
          interpreter.createModuleContext(module),
          null,
        );
        walk.memo.invalidate(callbacks, "current");
        followStaleCallables(walk);
      }
      return UNDEFINED_VALUE;
    });
    return calls.filter((call) => call.name === "record" || call.name === "other");
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
};

describe("escaped bound arguments", () => {
  it.each(["direct", "held", "rebound"])("follows callbacks bound to a %s escape", async (name) => {
    expect(await collectEscapedCalls(name)).toEqual([
      { name: "record", arguments: [JSON.stringify(name)] },
    ]);
  });

  it("prepends bound arguments before call-site arguments", async () => {
    expect(await collectEscapedCalls("called")).toEqual([
      { name: "record", arguments: ['"called"'] },
      { name: "other", arguments: ['"called"'] },
    ]);
  });

  it("does not escape bound callbacks the function never invokes", async () => {
    expect(await collectEscapedCalls("unused")).toEqual([]);
  });

  it("rebinds stale calls without prepending the bound arguments twice", async () => {
    expect(await collectEscapedCalls("stale", true)).toEqual([
      { name: "record", arguments: ['"stale"'] },
      { name: "other", arguments: ['"stale"'] },
    ]);
  });

  it("terminates recursive bound call chains", async () => {
    expect(await collectEscapedCalls("recursive")).toEqual([
      { name: "record", arguments: ['"recursive"'] },
    ]);
  });
});
