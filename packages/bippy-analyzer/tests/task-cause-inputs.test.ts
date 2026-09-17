import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  getTruthinessPredicate,
  recordDerivation,
  recordNegation,
} from "../src/evaluate/predicates.js";
import { branchValue, FALSE_VALUE, TRUE_VALUE, unknownValue } from "../src/evaluate/values.js";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import type { StaticRenderResult } from "../src/render/types.js";
import type { ExternalValueProvider } from "../src/types.js";

interface RecordedRender {
  rendered: StaticRenderResult;
  model: Pick<ReturnType<typeof enumerateStaticStates>, "tree" | "states" | "omitted">;
}

const directory = mkdtempSync(join(tmpdir(), "bippy-task-cause-inputs-"));
const dependency = join(directory, "node_modules", "cause-flags");
mkdirSync(dependency, { recursive: true });
writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(dependency, "package.json"),
  JSON.stringify({ name: "cause-flags", version: "0.0.0", types: "index.d.ts" }),
);
writeFileSync(join(dependency, "index.d.ts"), "export declare const combinedFlag: boolean;");
writeFileSync(
  join(directory, "app.tsx"),
  `import { useEffect, useState } from "react";
import { combinedFlag } from "cause-flags";
export default () => {
  const [, setValue] = useState(0);
  useEffect(() => {
    if (combinedFlag) queueMicrotask(() => setValue(1));
    else queueMicrotask(() => setValue(2));
  }, []);
  return <section />;
};`,
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const provider: ExternalValueProvider = (specifier, importedName) => {
  if (specifier !== "cause-flags" || importedName !== "combinedFlag") return null;
  const carried = unknownValue("carriedFlag");
  const fresh = unknownValue("freshFlag");
  const negated = recordNegation(unknownValue("notFresh"), fresh);
  const combined = recordDerivation(unknownValue(importedName), {
    kind: "logical",
    operator: "&&",
    left: carried,
    right: negated,
  });
  return branchValue(
    [TRUE_VALUE, FALSE_VALUE],
    importedName,
    null,
    0,
    getTruthinessPredicate(combined),
  );
};
const createRenderer = () =>
  createStaticRenderer({ rootDirectory: directory, externalValues: provider });
const outputs: RecordedRender[] = [];
const subsequentRenders = [
  { renderIndex: 1, rendererKind: "reused" },
  { renderIndex: 2, rendererKind: "independent" },
];
const getSnapshotContent = ({ capturedAt, ...snapshot }: StaticRenderResult["snapshot"]) => {
  expect(new Date(capturedAt).toISOString()).toBe(capturedAt);
  return snapshot;
};
const getRenderedContent = ({ snapshot, commits, ...rendered }: StaticRenderResult) => ({
  ...rendered,
  snapshot: getSnapshotContent(snapshot),
  commits: commits.map(getSnapshotContent),
});

beforeAll(async () => {
  for (let index = 0; index < 8; index++) getTruthinessPredicate(unknownValue(`unused-${index}`));
  const firstRenderer = await createRenderer();
  for (let index = 0; index < 3; index++) {
    const renderer = index === 2 ? await createRenderer() : firstRenderer;
    const rendered = await renderer.renderComponent(join(directory, "app.tsx"));
    const model = enumerateStaticStates(rendered);
    outputs.push({
      rendered,
      model: { tree: model.tree, states: model.states, omitted: model.omitted },
    });
  }
});

describe("retained task cause inputs", () => {
  it("retains both declarations when complementary microtasks simplify the commit guard", () => {
    expect(outputs).toHaveLength(3);
    for (const { rendered, model } of outputs) {
      expect(rendered.diagnostics).toEqual([]);
      expect(model.omitted).toBeNull();
      expect(model.states).toHaveLength(1);
      expect(rendered.stats.branchCount).toBe(0);
      expect(rendered.commits).toHaveLength(2);
      const causes = rendered.commitCauses ?? [];
      expect(causes).toHaveLength(2);
      expect(causes[1].guard).toEqual({ kind: "constant", value: true });
      const inputs = causes[1].inputs;
      expect(inputs).toHaveLength(2);
      expect(new Set(inputs.map((input) => input.id)).size).toBe(2);
      expect(inputs.map((input) => input.label).sort()).toEqual(["carriedFlag", "freshFlag"]);
      getRenderedContent(rendered);
    }
  });

  it.fails.each(subsequentRenders)(
    "preserves complete rendered contents with a $rendererKind renderer",
    ({ renderIndex }) => {
      expect(getRenderedContent(outputs[renderIndex].rendered)).toEqual(
        getRenderedContent(outputs[0].rendered),
      );
    },
  );

  it.fails.each(subsequentRenders)(
    "preserves the complete enumerated model with a $rendererKind renderer",
    ({ renderIndex }) => {
      expect(outputs[renderIndex].model).toEqual(outputs[0].model);
    },
  );
});
