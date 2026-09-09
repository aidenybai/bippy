import { describe, expect, it } from "vite-plus/test";
import { findThrown, getThrowCertainty, withoutThrows } from "../src/evaluate/thrown.js";
import {
  branchValue,
  listValue,
  optionalValue,
  primitiveValue,
  thrownValue,
  unknownValue,
} from "../src/evaluate/values.js";

const thrown = () => thrownValue("throw", primitiveValue("boom"));

describe("getThrowCertainty", () => {
  it("terminates on a list that may hold itself through a joined slot", () => {
    const list = listValue([primitiveValue(1)]);
    const slot = branchValue([unknownValue("stacked"), list], "if (stacked)");
    list.items = [optionalValue(slot, "slot written through an unknown key")];
    expect(getThrowCertainty(list)).toBe("never");
    expect(getThrowCertainty(slot)).toBe("never");
  });

  it("still reports throws reachable through a cyclic list", () => {
    const list = listValue([]);
    const slot = branchValue([thrown(), list], "if (stacked)");
    list.items = [slot];
    expect(getThrowCertainty(list)).toBe("maybe");
    expect(getThrowCertainty(slot)).toBe("maybe");
  });

  it("re-walks a mutated list instead of reusing a wrapper certainty computed mid-cycle", () => {
    const list = listValue([]);
    const slot = branchValue([primitiveValue(1), list], "if (stacked)");
    list.items = [slot];
    expect(getThrowCertainty(slot)).toBe("never");
    list.items = [slot, thrown()];
    expect(getThrowCertainty(slot)).toBe("maybe");
  });

  it("caches acyclic wrappers", () => {
    const wrapper = branchValue([primitiveValue(1), thrown()], "maybe throws");
    expect(getThrowCertainty(wrapper)).toBe("maybe");
    expect(getThrowCertainty(wrapper)).toBe("maybe");
  });

  it("finds the throw held by a cyclic list once", () => {
    const list = listValue([]);
    const boom = thrown();
    list.items = [branchValue([list, boom], "if (stacked)"), list];
    expect(findThrown(list)).toBe(boom);
    expect(findThrown(listValue([list, list]))).toBe(boom);
  });

  it("keeps a value that never throws, cyclic lists included", () => {
    const list = listValue([primitiveValue(1)]);
    list.items = [branchValue([list, primitiveValue(2)], "if (stacked)")];
    expect(withoutThrows(list)).toBe(list);
    const wrapper = branchValue([primitiveValue(1), primitiveValue(2)], "if (stacked)");
    expect(withoutThrows(wrapper)).toBe(wrapper);
  });
});
