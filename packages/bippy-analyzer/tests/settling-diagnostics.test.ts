import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const directory = mkdtempSync(join(tmpdir(), "bippy-settling-diagnostics-"));
writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it.each([
  {
    name: "does not report work created only by harness disposal",
    effect: "return () => queueMicrotask(() => {});",
    expected: [],
  },
  {
    name: "reports bounded-out work even when disposal cancels it",
    effect:
      "let handle; const repeat = () => { handle = setTimeout(repeat, 0); }; repeat(); return () => clearTimeout(handle);",
    expected: ["timers-unsettled"],
  },
  {
    name: "does not report a quiescent modeled interval as queued work",
    effect: "const handle = setInterval(() => {}, 0); return () => clearInterval(handle);",
    expected: [],
  },
])("$name", async ({ name, effect, expected }) => {
  const filePath = join(directory, `${name.replaceAll(" ", "-")}.tsx`);
  writeFileSync(
    filePath,
    `
    import { useEffect } from "react";
    export default () => {
      useEffect(() => { ${effect} }, []);
      return <main>settled</main>;
    };
  `,
  );
  const renderer = await createStaticRenderer({ rootDirectory: directory });
  const result = await renderer.renderComponent(filePath);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expected);
});
