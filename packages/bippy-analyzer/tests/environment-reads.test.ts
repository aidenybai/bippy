import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import clsx from "clsx";
import { addDays, format, isToday, startOfToday } from "date-fns";
import { merge, random } from "lodash-es";
import { describe, expect, it } from "vite-plus/test";
import { readsEnvironment as readsEnvironmentNamed } from "../src/evaluate/environment-reads.js";
import { fromNativeValue } from "../src/evaluate/native-values.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer, objectFromRecord } from "../src/index.js";

const readsEnvironment = (callee: Function): boolean =>
  readsEnvironmentNamed(callee, callee.name || "closure");

const stampModule = { stamp: () => Date.now(), label: (name: string) => `[${name}]` };

describe("readsEnvironment", () => {
  it("finds a read of the clock or of randomness in the function's own source", () => {
    expect(readsEnvironment(() => Date.now())).toBe(true);
    expect(readsEnvironment(() => new Date())).toBe(true);
    expect(readsEnvironment(() => Math.random())).toBe(true);
    expect(readsEnvironment(() => performance.now())).toBe(true);
    expect(readsEnvironment((time: number) => new Date(time))).toBe(false);
    expect(readsEnvironment((text: string) => Date.parse(text))).toBe(false);
    expect(readsEnvironment((value: number) => Math.round(value))).toBe(false);
  });

  it("follows the closure to the functions it may call", () => {
    const tick = () => performance.now();
    const elapsed = (since: number) => tick() - since;
    const twice = (since: number) => elapsed(since) * 2;
    expect(readsEnvironment(twice)).toBe(true);
    const stamped = (name: string) => `${name}@${stampModule.stamp()}`;
    expect(readsEnvironment(stamped)).toBe(true);
    const labeled = (name: string) => stampModule.label(name);
    expect(readsEnvironment(labeled)).toBe(false);
  });

  it("recognizes the globals a closure captured under its own names", () => {
    const draw = Math.random;
    const roll = (sides: number) => Math.floor(draw() * sides);
    expect(readsEnvironment(roll)).toBe(true);
    const nativeDate = Date;
    const at = (time: number) => new nativeDate(time);
    expect(readsEnvironment(at)).toBe(false);
    const current = () => nativeDate.now();
    expect(readsEnvironment(current)).toBe(true);
    const root = globalThis;
    const viaRoot = () => root.Date.now();
    expect(readsEnvironment(viaRoot)).toBe(true);
  });

  it("reads through a bound function to its target", () => {
    const stamp = (prefix: string) => `${prefix}${Date.now()}`;
    expect(readsEnvironment(stamp.bind(null, "t"))).toBe(true);
    expect(readsEnvironment(Math.max.bind(null, 0))).toBe(false);
  });

  it("finds the reads of installed packages' exports", () => {
    expect(readsEnvironment(isToday)).toBe(true);
    expect(readsEnvironment(random)).toBe(true);
    expect(readsEnvironment(format)).toBe(false);
    expect(readsEnvironment(merge)).toBe(false);
    expect(readsEnvironment(clsx)).toBe(false);
  });
});

const CLOCK_SOURCE = `
interface ClockProps {
  isToday(date: Date): boolean;
  startOfToday(): Date;
  random(lower: number, upper: number): number;
  addDays(date: Date, amount: number): Date;
}

const fixed = new Date("2020-01-01T00:00:00Z");

export const Clock = ({ isToday, startOfToday, random, addDays }: ClockProps) => (
  <p>
    {String(isToday(fixed))}
    {String(startOfToday().getFullYear())}
    {String(random(1, 6))}
    {addDays(fixed, 1).toISOString()}
  </p>
);
`;

const renderSource = async (
  fileName: string,
  source: string,
  exportName: string,
  props: object,
) => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-analyzer-environment-reads-"));
  writeFileSync(join(rootDirectory, fileName), source);
  const renderer = await createStaticRenderer({ rootDirectory });
  const result = await renderer.renderComponent(join(rootDirectory, fileName), {
    exportName,
    props: objectFromRecord(
      Object.fromEntries(
        Object.entries(props).map(([name, value]) => [name, fromNativeValue(value, name, null)]),
      ),
    ),
  });
  return { result, pattern: formatPattern(getRenderPattern(result)) };
};

describe("native functions that read the environment", () => {
  it("are evaluated from source over the analysis's clock, not run at the analysis's time", async () => {
    const { result, pattern } = await renderSource("clock.tsx", CLOCK_SOURCE, "Clock", {
      isToday,
      startOfToday,
      random,
      addDays,
    });
    expect(result.stats.unknownCount).toBe(0);
    expect(pattern).toBe(
      [
        "<HostRoot>",
        "  <Clock>",
        "    <p>",
        "      #text(?)",
        "      #text(?)",
        "      #text(?)",
        '      "2020-01-02T00:00:00.000Z"',
      ].join("\n"),
    );
  });
});
