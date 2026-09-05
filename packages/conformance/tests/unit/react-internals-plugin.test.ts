import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import ReactDevToolsCore from "react-devtools-core";
import type { ReactDevToolsCore as ReactDevToolsCoreModule } from "react-devtools-core";
import { describe, expect, it } from "vite-plus/test";
import {
  createGeneratedReactInternals,
  generateReactInternals,
} from "../../../bippy/scripts/react-internals-plugin.js";

const TYPESCRIPT_COMPILER_TEST_TIMEOUT_MS = 15_000;

const createReactDevToolsCore = (
  overrides: Partial<ReactDevToolsCoreModule> = {},
): ReactDevToolsCoreModule => ({
  ...ReactDevToolsCore,
  ...overrides,
});

describe("React internals generation", () => {
  it("accepts the patched React DevTools exports and emits TypeScript", async () => {
    const generatedModule = await createGeneratedReactInternals(ReactDevToolsCore);
    expect(generatedModule).toContain("export const ReactSymbols = {");
    expect(generatedModule).toContain("HostRoot: 3,");
    expect(generatedModule).toContain("} as const;");
    expect(generatedModule).not.toContain("ActivityComponentTag");
    expect(generatedModule).not.toContain("ELEMENT_TYPE_SYMBOL_STRING");
  });

  it("rejects invalid and unordered version ranges", async () => {
    await expect(
      createGeneratedReactInternals(
        createReactDevToolsCore({
          ReactWorkTagVersionRanges: [
            ReactDevToolsCore.ReactWorkTagVersionRanges[0],
            {
              minimumVersion: "invalid",
              version: "16.4.3-alpha",
            },
          ],
        }),
      ),
    ).rejects.toThrow();

    await expect(
      createGeneratedReactInternals(
        createReactDevToolsCore({
          ReactWorkTagVersionRanges: [
            ReactDevToolsCore.ReactWorkTagVersionRanges[0],
            ReactDevToolsCore.ReactWorkTagVersionRanges[2],
            ReactDevToolsCore.ReactWorkTagVersionRanges[1],
          ],
        }),
      ),
    ).rejects.toThrow(/overlaps|strictly increasing/);
  });

  it("rejects overlapping flags, work tags, and hidden future tables", async () => {
    await expect(
      createGeneratedReactInternals(
        createReactDevToolsCore({
          ReactTypeOfSideEffect: {
            ...ReactDevToolsCore.ReactTypeOfSideEffect,
            Update: ReactDevToolsCore.ReactTypeOfSideEffect.Placement,
          },
        }),
      ),
    ).rejects.toThrow(/Fiber flags/);

    await expect(
      createGeneratedReactInternals(
        createReactDevToolsCore({
          getInternalReactConstants: (reactVersion) => {
            const constants = ReactDevToolsCore.getInternalReactConstants(reactVersion);
            return {
              ReactTypeOfWork: {
                ...constants.ReactTypeOfWork,
                HostText: constants.ReactTypeOfWork.HostComponent,
              },
            };
          },
        }),
      ),
    ).rejects.toThrow(/overlapping active work tags/);

    await expect(
      createGeneratedReactInternals(
        createReactDevToolsCore({
          getInternalReactConstants: (reactVersion) => {
            const constants = ReactDevToolsCore.getInternalReactConstants(reactVersion);
            if (!reactVersion.startsWith("999999")) return constants;
            return {
              ReactTypeOfWork: {
                ...constants.ReactTypeOfWork,
                HostText: constants.ReactTypeOfWork.HostText + 100,
              },
            };
          },
        }),
      ),
    ).rejects.toThrow(/added a work-tag range/);
  });

  it("rejects unhandled versioned constants instead of silently stripping them", async () => {
    await expect(
      createGeneratedReactInternals({
        ...ReactDevToolsCore,
        ReactBuildType: {
          ...ReactDevToolsCore.ReactBuildType,
          Profiling: 2,
        },
      }),
    ).rejects.toThrow();
  });

  it(
    "checks stale output without modifying it and regenerates atomically",
    async () => {
      const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "bippy-react-internals-"));
      const generatedModulePath = resolve(temporaryDirectory, "react-work-tags.ts");
      const declarationModulePath = resolve(temporaryDirectory, "react-work-tags.d.ts");
      const runtimeModulePath = resolve(temporaryDirectory, "react-work-tags.js");
      try {
        writeFileSync(declarationModulePath, "legacy");
        writeFileSync(runtimeModulePath, "legacy");
        await generateReactInternals({
          generatedModulePath,
          mode: "generate",
          reactDevToolsCore: ReactDevToolsCore,
        });
        expect(existsSync(declarationModulePath)).toBe(false);
        expect(existsSync(runtimeModulePath)).toBe(false);
        const generatedModule = readFileSync(generatedModulePath, "utf8");
        await generateReactInternals({
          generatedModulePath,
          mode: "check",
          reactDevToolsCore: ReactDevToolsCore,
        });

        writeFileSync(generatedModulePath, "stale");
        await expect(
          generateReactInternals({
            generatedModulePath,
            mode: "check",
            reactDevToolsCore: ReactDevToolsCore,
          }),
        ).rejects.toThrow(/stale/);
        expect(readFileSync(generatedModulePath, "utf8")).toBe("stale");

        writeFileSync(generatedModulePath, generatedModule);
        writeFileSync(runtimeModulePath, "legacy");
        await expect(
          generateReactInternals({
            generatedModulePath,
            mode: "check",
            reactDevToolsCore: ReactDevToolsCore,
          }),
        ).rejects.toThrow(/stale/);
        expect(readFileSync(generatedModulePath, "utf8")).toBe(generatedModule);
        expect(readFileSync(runtimeModulePath, "utf8")).toBe("legacy");
      } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
      }
    },
    TYPESCRIPT_COMPILER_TEST_TIMEOUT_MS,
  );
});
