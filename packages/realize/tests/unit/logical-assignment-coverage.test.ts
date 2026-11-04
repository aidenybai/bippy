import { describe, expect, it } from "vite-plus/test";
import { addCoverageCounters } from "../conformance/verifier/harness/transforms";
import type { Counter } from "../conformance/verifier/types";

const runCounted = (
  code: string,
  target: string,
  operator: string,
): { result: unknown; counted: unknown[] } => {
  const start = code.indexOf(`${target} ${operator}`);
  const counter: Counter = {
    id: "test",
    file: "test.ts",
    start,
    end: start + target.length,
    kind: "nullish",
  };
  const counted: unknown[] = [];
  const instrumented = addCoverageCounters(code, [counter]).toString();
  const run = new Function("__bippyCoverage", instrumented);
  const result: unknown = run((_id: string, _kind: string, value: unknown) => {
    counted.push(value);
    return value;
  });
  return { result, counted };
};

describe("logical assignment coverage", () => {
  it("counts the target of ??= and still assigns it", () => {
    expect(
      runCounted('let label = null; label ??= "Untitled"; return label;', "label", "??="),
    ).toEqual({ result: "Untitled", counted: [null] });
  });

  it("counts a member target of ||= and keeps a truthy value", () => {
    expect(
      runCounted("const seen = { a: 1 }; seen.a ||= 5; return seen.a;", "seen.a", "||="),
    ).toEqual({ result: 1, counted: [1] });
  });

  it("counts the target of &&= inside an expression", () => {
    expect(
      runCounted(
        'let summary = "compact"; const length = (summary &&= summary.toUpperCase()).length; return [summary, length];',
        "summary",
        "&&=",
      ),
    ).toEqual({ result: ["COMPACT", 7], counted: ["compact"] });
  });
});
