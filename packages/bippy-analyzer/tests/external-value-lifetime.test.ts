import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { getTruthinessPredicate } from "../src/evaluate/predicates.js";
import { branchValue, FALSE_VALUE, TRUE_VALUE, unknownValue } from "../src/evaluate/values.js";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import type { PatternNode } from "../src/harness/static-pattern.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import type { ExternalValueProvider, StaticRenderResult, StaticValue } from "../src/types.js";

const directory = mkdtempSync(join(tmpdir(), "bippy-external-value-lifetime-"));
const dependency = join(directory, "node_modules", "lifetime-flags");
mkdirSync(dependency, { recursive: true });
writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(dependency, "package.json"),
  JSON.stringify({ name: "lifetime-flags", version: "0.0.0", types: "index.d.ts" }),
);
writeFileSync(
  join(dependency, "index.d.ts"),
  "export declare const carriedFlag: boolean; export declare const freshFlag: boolean;",
);
writeFileSync(
  join(directory, "app.tsx"),
  'import { carriedFlag, freshFlag } from "lifetime-flags"; export default () => carriedFlag && !freshFlag ? <section /> : <aside />;',
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const createFlag = (label: string): StaticValue =>
  branchValue(
    [TRUE_VALUE, FALSE_VALUE],
    label,
    null,
    0,
    getTruthinessPredicate(unknownValue(label)),
  );

const createProvider = (
  getCarried: () => StaticValue,
  getFresh: () => StaticValue,
): ExternalValueProvider => {
  let carried: StaticValue | undefined;
  let fresh: StaticValue | undefined;
  return (specifier, importedName) => {
    if (specifier !== "lifetime-flags") return null;
    if (importedName === "carriedFlag") return (carried ??= getCarried());
    if (importedName === "freshFlag") return (fresh ??= getFresh());
    return null;
  };
};

const getHostNames = (nodes: PatternNode[]): string[] =>
  nodes.flatMap((node) => {
    if (node.kind !== "fiber") throw new Error(`Expected a fiber, received ${node.kind}`);
    const children = getHostNames(node.children);
    if (node.tag !== "HostComponent") return children;
    if (node.name === null) throw new Error("Expected a named host component");
    return [node.name, ...children];
  });

const expectBranches = (rendered: StaticRenderResult, expected: string[]) => {
  const model = enumerateStaticStates(rendered);
  expect(rendered.diagnostics).toEqual([]);
  expect(model.omitted).toBeNull();
  expect(
    [...new Set(model.states.map((state) => getHostNames(state.tree).join("")))].sort(),
  ).toEqual(expected);
};

const createRenderer = (externalValues: ExternalValueProvider) =>
  createStaticRenderer({ rootDirectory: directory, externalValues });

const render = (renderer: Awaited<ReturnType<typeof createRenderer>>) =>
  renderer.renderComponent(join(directory, "app.tsx"));

describe("external value lifetimes", () => {
  it("preserves a carried input independently of fresh inputs in later renderers", async () => {
    let carried: StaticValue | undefined;
    const getProvider = () =>
      createProvider(
        () => (carried ??= createFlag("carried")),
        () => createFlag("fresh"),
      );
    const initialRenderer = await createRenderer(getProvider());
    expectBranches(await render(initialRenderer), ["aside", "section"]);
    expect(carried).toBeDefined();
    const derivedRenderer = initialRenderer.derive({ externalValues: getProvider() });
    expectBranches(await render(derivedRenderer), ["aside", "section"]);
    expectBranches(await render(await createRenderer(getProvider())), ["aside", "section"]);
  });

  it("keeps equal-description inputs independent", async () => {
    const renderer = await createRenderer(
      createProvider(
        () => createFlag("flag"),
        () => createFlag("flag"),
      ),
    );
    expectBranches(await render(renderer), ["aside", "section"]);
  });

  it("preserves correlation when both exports share an input", async () => {
    let shared: StaticValue | undefined;
    const getShared = () => (shared ??= createFlag("shared"));
    const renderer = await createRenderer(createProvider(getShared, getShared));
    expectBranches(await render(renderer), ["aside"]);
  });
});
