import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  getDependencyCycles,
  getModuleDependencies,
  type ModuleDependency,
} from "./helpers/module-dependencies.js";

const directory = resolve("/engine/src");
const getDependencies = (content: string): ModuleDependency[] =>
  getModuleDependencies(directory, resolve(directory, "evaluate/consumer.ts"), content);

const edge = (source: string, target: string, isTypeOnly = false): ModuleDependency => ({
  source,
  target,
  isTypeOnly,
});

describe("module dependency extraction", () => {
  it("distinguishes type-only imports from runtime and mixed imports", () => {
    expect(
      getDependencies(`
      import type { Value } from "./types.js";
      import { type Context } from "./context.js";
      import { type Options, run } from "./operations.js";
      import Default, { type Settings } from "./defaults.js";
      import * as Runtime from "./runtime.js";
      import "./initialize.js";
      import {} from "./empty-bindings.js";
    `),
    ).toEqual([
      edge("evaluate/consumer.ts", "evaluate/types.ts", true),
      edge("evaluate/consumer.ts", "evaluate/context.ts", true),
      edge("evaluate/consumer.ts", "evaluate/operations.ts"),
      edge("evaluate/consumer.ts", "evaluate/defaults.ts"),
      edge("evaluate/consumer.ts", "evaluate/runtime.ts"),
      edge("evaluate/consumer.ts", "evaluate/initialize.ts"),
      edge("evaluate/consumer.ts", "evaluate/empty-bindings.ts"),
    ]);
  });

  it("follows barrel re-exports and distinguishes type re-exports", () => {
    expect(
      getDependencies(`
      export * from "./runtime.js";
      export * as namespace from "./namespace.js";
      export type * from "./types.js";
      export { type Options } from "./options.js";
      export { type Config, run } from "./mixed.js";
    `),
    ).toEqual([
      edge("evaluate/consumer.ts", "evaluate/runtime.ts"),
      edge("evaluate/consumer.ts", "evaluate/namespace.ts"),
      edge("evaluate/consumer.ts", "evaluate/types.ts", true),
      edge("evaluate/consumer.ts", "evaluate/options.ts", true),
      edge("evaluate/consumer.ts", "evaluate/mixed.ts"),
    ]);
  });

  it("finds nested import expressions, import types, and literal requires", () => {
    expect(
      getDependencies(`
      type Result = import("./types.js").Result;
      const load = () => import("./runtime.js");
      const read = () => require("./required.js");
      const dynamic = (name: string) => import(name);
    `),
    ).toEqual([
      edge("evaluate/consumer.ts", "evaluate/types.ts", true),
      edge("evaluate/consumer.ts", "evaluate/runtime.ts"),
      edge("evaluate/consumer.ts", "evaluate/required.ts"),
    ]);
  });

  it("resolves package self-imports without treating external packages as engine modules", () => {
    expect(
      getDependencies(`
      import type { StaticValue } from "bippy-analyzer";
      import { buildSymbolicTree } from "bippy-analyzer/harness";
      import React from "react";
      import { readFileSync } from "node:fs";
    `),
    ).toEqual([
      edge("evaluate/consumer.ts", "index.ts", true),
      edge("evaluate/consumer.ts", "harness/index.ts"),
    ]);
  });
});

describe("whole-graph cycle detection", () => {
  it("does not mistake a shared dependency for a cycle", () => {
    expect(
      getDependencyCycles([
        edge("entry", "left"),
        edge("entry", "right"),
        edge("left", "shared"),
        edge("right", "shared"),
      ]),
    ).toEqual([]);
  });

  it("finds cycles that pass through modules outside the protected subsystem", () => {
    expect(
      getDependencyCycles([
        edge("evaluate/completion.ts", "support/barrel.ts"),
        edge("support/barrel.ts", "support/operations.ts"),
        edge("support/operations.ts", "evaluate/completion.ts"),
      ]),
    ).toEqual([["evaluate/completion.ts", "support/barrel.ts", "support/operations.ts"]]);
  });

  it("groups overlapping cycles and keeps separate cycles distinct", () => {
    expect(
      getDependencyCycles([
        edge("alpha", "beta"),
        edge("beta", "gamma"),
        edge("gamma", "alpha"),
        edge("gamma", "delta"),
        edge("delta", "beta"),
        edge("separate", "other"),
        edge("other", "separate"),
        edge("delta", "separate"),
      ]),
    ).toEqual([
      ["alpha", "beta", "delta", "gamma"],
      ["other", "separate"],
    ]);
  });

  it("reports self-imports and deduplicates repeated edges", () => {
    expect(getDependencyCycles([edge("self", "self"), edge("self", "self")])).toEqual([["self"]]);
  });

  it("lets runtime validation exclude type-only cycles without hiding contract cycles", () => {
    const dependencies = [edge("left", "right"), edge("right", "left", true)];
    expect(getDependencyCycles(dependencies)).toEqual([["left", "right"]]);
    expect(getDependencyCycles(dependencies.filter(({ isTypeOnly }) => !isTypeOnly))).toEqual([]);
  });
});
