import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

const evaluateWithConfig = async (
  viteConfig: string,
  source: string,
  exportNames: string[],
): Promise<Record<string, string>> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-vite-defines-"));
  writeFileSync(join(rootDirectory, "vite.config.ts"), viteConfig);
  const entryFile = join(rootDirectory, "module.ts");
  writeFileSync(entryFile, source);
  const renderer = createStaticRenderer({ rootDirectory });
  const described: Record<string, string> = {};
  await renderer.renderWith((interpreter) => {
    const module = renderer.loadModule(entryFile);
    if (!module) throw new Error(`could not parse ${entryFile}`);
    const context = interpreter.createModuleContext(module);
    for (const exportName of exportNames) {
      const exported = interpreter.evaluateModuleExport(module, exportName);
      described[exportName] = describeValue(interpreter.callValue(exported, [], context, null));
    }
    return UNDEFINED_VALUE;
  });
  return described;
};

const READERS = `
declare const __APP_VERSION__: string;
declare const __FLAGS__: { beta: boolean };
declare const __RELEASE__: string;
declare const __COUNT__: number;
declare const __BUILD_TIME__: string;
export const version = () => __APP_VERSION__;
export const beta = () => __FLAGS__.beta;
export const release = () => __RELEASE__;
export const count = () => __COUNT__ + 1;
export const buildTime = () => __BUILD_TIME__;
export const nodeEnv = () => process.env.NODE_ENV;
export const isDefinedGlobal = () => "__APP_VERSION__" in globalThis;
`;

describe("vite `define` in dev", () => {
  it("assigns each entry's code text, evaluated, onto the window before the app runs", async () => {
    const described = await evaluateWithConfig(
      `
const pkg = { version: "1.2.3" };
export default {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __FLAGS__: { beta: true },
    __RELEASE__: "'r' + 7",
    __COUNT__: 41,
    "process.env.NODE_ENV": JSON.stringify("development"),
    "import.meta.env.VITE_SKIPPED": '"skipped"',
  },
};
`,
      READERS,
      ["version", "beta", "release", "count", "nodeEnv", "isDefinedGlobal"],
    );
    expect(described).toEqual({
      version: '"1.2.3"',
      beta: "true",
      release: '"r7"',
      count: "42",
      nodeEnv: '"development"',
      isDefinedGlobal: "true",
    });
  });

  it("calls a config callback with the dev server's ConfigEnv", async () => {
    const described = await evaluateWithConfig(
      `
export default ({ command, mode }) => ({
  define: { __RELEASE__: JSON.stringify(\`\${command}:\${mode}\`) },
});
`,
      READERS,
      ["release"],
    );
    expect(described).toEqual({ release: '"serve:development"' });
  });

  it("keeps a value computed when the dev server starts an honest unknown string", async () => {
    const described = await evaluateWithConfig(
      `
export default {
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
};
`,
      READERS,
      ["buildTime"],
    );
    expect(described.buildTime).toBe(
      "<string: vite define `__BUILD_TIME__`: JSON.stringify of new Date().toISOString()>",
    );
  });
});
