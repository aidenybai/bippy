import { describe, expect, it } from "vite-plus/test";
import { addAbstract, compareAbstract, containsValue } from "../../src/core/model/abstract";
import { createDomain, getValueLabels } from "../../src/core/model/domains";
import type { Abstract } from "../../src/core/model/types";
import type { Domain } from "../../src/core/types";

const NUMBER: Domain = {
  kind: "Cases",
  cases: [{ kind: "Type", text: "number", primitive: "number", isArrayLike: false }],
  origin: "type",
};

const numberDomain = (literals: number[]) =>
  createDomain(NUMBER, { literals, isTruthinessTested: false }, false);

const getAbstract = (literals: number[], label: string): Abstract => {
  const value = numberDomain(literals).find((candidate) => candidate.label === label);
  if (!value) throw new Error(`No value ${label}`);
  return value.abstract;
};

describe("abstract values", () => {
  it("gives a number domain a NaN value outside every range", () => {
    expect(getValueLabels(numberDomain([1]))).toEqual(["<1", "1", ">1", "NaN"]);
    const nan = getAbstract([1], "NaN");
    expect(compareAbstract(nan, "<", 1)).toBe(false);
    expect(compareAbstract(nan, ">=", 1)).toBe(false);
    expect(containsValue(nan, NaN)).toBe(true);
    expect(containsValue(getAbstract([1], ">1"), NaN)).toBe(false);
  });

  it("includes the infinities at both ends of a number domain", () => {
    expect(containsValue(getAbstract([1], ">1"), Infinity)).toBe(true);
    expect(containsValue(getAbstract([1], "<1"), -Infinity)).toBe(true);
  });

  it("coerces a range under loose equality", () => {
    const one = getAbstract([0, 2], "(0, 2)");
    expect(compareAbstract(getAbstract([0, 2], ">2"), "==", "1")).toBe(false);
    expect(compareAbstract(one, "==", "1")).toBeNull();
    expect(compareAbstract(one, "===", "1")).toBe(false);
  });

  it("leaves a string class open under loose equality with a number", () => {
    const other: Abstract = { kind: "Other", type: "string", excluded: [""] };
    expect(compareAbstract(other, "==", 1)).toBeNull();
    expect(compareAbstract(other, "===", 1)).toBe(false);
    expect(compareAbstract(other, "==", null)).toBe(false);
  });

  it("does not decide loose equality from truthiness alone", () => {
    expect(compareAbstract({ kind: "Truthy" }, "==", 0)).toBeNull();
    expect(compareAbstract({ kind: "Truthy" }, "===", 0)).toBe(false);
    expect(compareAbstract({ kind: "Truthy" }, "==", undefined)).toBe(false);
  });

  it("includes a bound that rounds when shifted", () => {
    const shifted = addAbstract(getAbstract([0.1, 1e308], "(0.1, 1e+308)"), {
      kind: "Exact",
      value: 1e308,
    });
    expect(containsValue(shifted, 1e308)).toBe(true);
    expect(containsValue(shifted, Infinity)).toBe(true);
  });
});
