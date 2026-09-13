import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runWithProcessEnvironment } from "../src/corpus/process-environment.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import type { JsonValue } from "../src/types.js";

const ROOT = join(import.meta.dirname, "fixtures/vite-resolved-environment");

describe("Vite resolved client environments", () => {
  it.each(["development", "production", "test"])(
    "reads resolved values for %s",
    async (nodeEnvironment) => {
      await runWithProcessEnvironment(
        () => ({
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) => !name.startsWith("VITE_") && !name.startsWith("PUBLIC_"),
            ),
          ),
          NODE_ENV: nodeEnvironment,
        }),
        async () => {
          const renderer = await createStaticRenderer({
            rootDirectory: ROOT,
            devCommand: "vite --mode staging",
            externalPackageAllowList: ["environment-branch"],
          });
          const rendered = await renderer.renderEntry("src/main.tsx");
          const pattern = formatPattern(getRenderPattern(rendered));
          for (const value of [
            nodeEnvironment,
            nodeEnvironment === "production" ? "production" : "not-production",
            "staging",
            "from-file",
            "second-prefix",
            "configured",
            "known",
          ]) {
            expect(pattern).toContain(JSON.stringify(value));
          }
          for (const host of [
            nodeEnvironment === "production" ? "strong" : "span",
            nodeEnvironment === "production" ? "u" : "em",
            "ol",
            "i",
            "aside",
            "nav",
          ]) {
            expect(pattern).toContain(`<${host}>`);
          }
          expect(pattern).toContain(
            '"BASE_URL,DEFINED,DEV,MODE,OBJECT,PROD,PUBLIC_MESSAGE,SSR,VITE_MESSAGE"',
          );
          expect(pattern).not.toContain("?branch");
        },
      );
    },
  );

  it("retains opaque native define expressions instead of using an environment fallback", async () => {
    await runWithProcessEnvironment(
      () => ({ ...process.env, BIPPY_OPAQUE_ENV: "1" }),
      async () => {
        const renderer = await createStaticRenderer({
          rootDirectory: ROOT,
          devCommand: "vite --mode staging",
          externalPackageAllowList: ["environment-branch"],
        });
        const pattern = formatPattern(getRenderPattern(await renderer.renderEntry("src/main.tsx")));
        expect(pattern).toContain("?branch");
        expect(pattern).toContain("<strong>");
        expect(pattern).toContain("<span>");
      },
    );
  });

  it.each<Record<string, JsonValue>>([
    { "process.env.NODE_ENV": "development" },
    { "process.env": { NODE_ENV: "development" } },
  ])("keeps caller NODE_ENV overrides consistent with CommonJS extraction: %j", async (defines) => {
    await runWithProcessEnvironment(
      () => ({ ...process.env, NODE_ENV: "production" }),
      async () => {
        const renderer = await createStaticRenderer({
          rootDirectory: ROOT,
          devCommand: "vite --mode staging",
          externalPackageAllowList: ["environment-branch"],
          defines,
        });
        const pattern = formatPattern(getRenderPattern(await renderer.renderEntry("src/main.tsx")));
        expect(pattern).toContain('"development"');
        expect(pattern).toContain('"not-production"');
      },
    );
  });

  it("guards mutations when the first environment access occurs inside an effect", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: ROOT,
      devCommand: "vite --mode staging",
    });
    const stateSpace = enumerateStaticStates(
      await renderer.renderComponent("src/guarded-mutation.tsx"),
    );
    const states = stateSpace.states.map((state) => formatPattern(state.tree));
    expect(
      states.some((pattern) => pattern.includes("<aside>") && pattern.includes("<footer>")),
    ).toBe(true);
    expect(
      states.some((pattern) => pattern.includes("<canvas>") && pattern.includes("<strong>")),
    ).toBe(true);
    expect(
      states.some((pattern) => pattern.includes("<aside>") && pattern.includes("<strong>")),
    ).toBe(false);
    expect(stateSpace.omitted).toBeNull();
  });

  it("gives dotted caller defines precedence over whole environment objects", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: ROOT,
      devCommand: "vite --mode staging",
      defines: {
        "import.meta.env": { VITE_MESSAGE: "whole", OPTIONAL: null },
        "import.meta.env.VITE_MESSAGE": "dotted",
      },
    });
    const pattern = formatPattern(
      getRenderPattern(await renderer.renderComponent("src/mutation.tsx")),
    );
    expect(pattern.match(/"dotted"/g)).toHaveLength(2);
    expect(pattern).not.toContain('"whole"');
    const filePath = join(ROOT, "src/caller-environment.tsx");
    renderer.graph.addVirtualModule(
      filePath,
      "export default () => <main>{import.meta.env.OPTIONAL === undefined ? <aside /> : <footer />}</main>",
    );
    const optionalPattern = formatPattern(
      getRenderPattern(await renderer.renderComponent(filePath)),
    );
    expect(optionalPattern).toContain("<aside>");
    expect(optionalPattern).not.toContain("<footer>");
  });

  it("isolates mutable environment objects by module and by render", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: ROOT,
      devCommand: "vite --mode staging",
    });
    for (const currentRenderer of [renderer, renderer.derive({})]) {
      const rendered = await currentRenderer.renderComponent("src/mutation.tsx");
      const pattern = formatPattern(getRenderPattern(rendered));
      expect(pattern.match(/"from-file"/g)).toHaveLength(2);
      expect(pattern.match(/"changed"/g)).toHaveLength(2);
      expect(pattern.match(/"mutated"/g)).toHaveLength(2);
      expect(pattern).not.toContain('"configured"');
    }
  });
});
