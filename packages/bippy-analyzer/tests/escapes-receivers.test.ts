import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
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
class Handler {
  callback = record;
  run(value: string) { this.callback(value); }
  recur() { this.run("recursive"); this.recur(); }
  arrow = (value: string) => this.callback(value);
}
export const first = new Handler();
const second = { callback: other, run: first.run };
const hand = (callback: (value: string) => void) => callback("handed");
export const receivers = () => { first.run("first"); second.run("second"); };
export const extracted = () => hand(first.run);
export const bound = first.run.bind(second, "bound");
export const arrow = first.arrow.bind(second, "arrow");
export const recursive = () => first.recur();
export const stale = () => first.run("stale");
export const replace = () => { first.callback = other; };
`;

const collectCalls = async (exportName: string, shouldReplace = false): Promise<EscapedCall[]> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-escape-receivers-"));
  try {
    const entryFile = join(rootDirectory, "module.ts");
    writeFileSync(entryFile, SOURCE);
    const renderer = await createStaticRenderer({ rootDirectory });
    const calls: EscapedCall[] = [];
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(entryFile);
      if (!module) throw new Error(`could not parse ${entryFile}`);
      const walk: EscapeWalk = {
        memo: new EscapeMemo(() => {}),
        resolveModuleBinding: (innerModule, name) =>
          interpreter.evaluateModuleBinding(innerModule, name, null),
        visit: (callable, frame) => {
          if (callable.name !== "record" && callable.name !== "other") return;
          calls.push({
            name: callable.name,
            arguments:
              frame?.arguments.map((value) => (value ? describeValue(value) : null)) ?? null,
          });
        },
      };
      forEachEscapedCallable(interpreter.evaluateModuleExport(module, exportName), walk);
      if (shouldReplace) {
        const first = interpreter.evaluateModuleExport(module, "first");
        if (first.kind !== "object") throw new Error("expected handler");
        interpreter.callValue(
          interpreter.evaluateModuleExport(module, "replace"),
          [],
          interpreter.createModuleContext(module),
          null,
        );
        walk.memo.invalidate(first, "callback");
        followStaleCallables(walk);
      }
      return UNDEFINED_VALUE;
    });
    return calls;
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
};

it("keeps member-call receivers separate", async () => {
  expect(await collectCalls("receivers")).toEqual([
    { name: "record", arguments: ['"first"'] },
    { name: "other", arguments: ['"second"'] },
  ]);
});
it("does not bind a method passed as an argument", async () => {
  expect(await collectCalls("extracted")).toEqual([]);
});
it("retains an explicitly bound receiver", async () => {
  expect(await collectCalls("bound")).toEqual([{ name: "other", arguments: ['"bound"'] }]);
});
it("retains an arrow's lexical receiver", async () => {
  expect(await collectCalls("arrow")).toEqual([{ name: "record", arguments: ['"arrow"'] }]);
});
it("terminates recursive method walks", async () => {
  expect(await collectCalls("recursive")).toEqual([{ name: "record", arguments: ['"recursive"'] }]);
});
it("revisits receiver-dependent reads after mutation", async () => {
  expect(await collectCalls("stale", true)).toEqual([
    { name: "record", arguments: ['"stale"'] },
    { name: "other", arguments: ['"stale"'] },
  ]);
});
