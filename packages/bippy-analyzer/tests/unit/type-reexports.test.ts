import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  getTypeOnlyNames,
  removeTypeReexports,
} from "../conformance/verifier/harness/type-exports";

const writeSource = (source: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "type-exports-")), "chart-props.ts");
  writeFileSync(file, source);
  return file;
};

const rewrite = async (code: string, typeOnlyNames: string[]): Promise<string | undefined> =>
  (await removeTypeReexports(code, async () => new Set(typeOnlyNames)))?.toString();

describe("type re-exports", () => {
  it("lists names a module exports only as types", () => {
    const file = writeSource(`
      export type EventProps = { value: string } | null;
      export interface ChartProps { data: unknown[] }
      type Formatter = (value: number) => string;
      export type { Formatter };
      export interface Color { name: string }
      export const Color = { red: "red" };
      export const ChartDefaults = {};
    `);
    expect([...getTypeOnlyNames(file)].sort()).toEqual(["ChartProps", "EventProps", "Formatter"]);
  });

  it("drops a re-exported type and keeps the values beside it", async () => {
    expect(
      await rewrite('export { EventProps, ChartDefaults } from "./chart-props";', ["EventProps"]),
    ).toBe('export { ChartDefaults } from "./chart-props";');
  });

  it("drops a statement that re-exports only types", async () => {
    expect(await rewrite('export { EventProps } from "./chart-props";', ["EventProps"])).toBe("");
  });

  it("leaves value re-exports alone", async () => {
    expect(
      await rewrite('export { ChartDefaults } from "./chart-props";', ["EventProps"]),
    ).toBeUndefined();
  });
});
