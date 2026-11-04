import { describe, expect, it } from "vite-plus/test";
import { compareAbstract } from "../../src/core/model/abstract";
import { createDomain, getValueLabels } from "../../src/core/model/domains";
import type { Domain, PrimitiveValue } from "../../src/core/types";

const untested = { literals: [], isTruthinessTested: false };

const literalDomain = (values: PrimitiveValue[]): Domain => ({
  kind: "Cases",
  cases: values.map((value) => ({ kind: "Literal", value })),
  origin: "type",
});

describe("domain labels", () => {
  it("keeps literals whose labels collide", () => {
    expect(getValueLabels(createDomain(literalDomain([1, "1"]), untested, false))).toEqual([
      "1",
      "1 2",
    ]);
    expect(getValueLabels(createDomain(literalDomain([null, "null"]), untested, false))).toEqual([
      "null",
      "null 2",
    ]);
    expect(getValueLabels(createDomain(literalDomain(["", "empty"]), untested, false))).toEqual([
      "empty",
      "empty 2",
    ]);
  });

  it("keeps both literals an untyped place is compared with", () => {
    const domain = createDomain(null, { literals: [1, "1"], isTruthinessTested: false }, false);
    expect(getValueLabels(domain)).toEqual(["1", "1 2", "other"]);
    expect(domain.map((value) => compareAbstract(value.abstract, "===", "1"))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("drops a literal the type and a test both produce", () => {
    const domain: Domain = {
      kind: "Cases",
      cases: [
        { kind: "Literal", value: "a" },
        { kind: "Type", text: "string", primitive: "string", isArrayLike: false },
      ],
      origin: "type",
    };
    expect(
      getValueLabels(createDomain(domain, { literals: ["a"], isTruthinessTested: false }, false)),
    ).toEqual(["a", "other string"]);
  });
});
