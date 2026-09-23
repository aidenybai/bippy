import { describe, expect, it } from "vite-plus/test";
import {
  getListDeletePermission,
  getListExtensibility,
  getListIntegrityTest,
  getListWritePermission,
  getNextObjectIntegrity,
  getObjectExtensibility,
  getObjectIntegrityTest,
  isListDefinitelyFrozen,
} from "../src/evaluate/object-integrity.js";
import {
  branchValue,
  FALSE_VALUE,
  listValue,
  objectValue,
  primitiveValue,
  TRUE_VALUE,
  unknownValue,
} from "../src/evaluate/values.js";
import type { StaticListValue, StaticObjectValue, StaticValue } from "../src/types.js";

const level = (name: "extensible" | "non-extensible" | "sealed" | "frozen"): StaticValue =>
  primitiveValue(name);

const booleanResult = (value: StaticValue): boolean => {
  if (value.kind !== "primitive" || typeof value.value !== "boolean") {
    throw new Error(`expected a boolean, received ${value.kind}`);
  }
  return value.value;
};

const stringResult = (value: StaticValue): string => {
  if (value.kind !== "primitive" || typeof value.value !== "string") {
    throw new Error(`expected a string, received ${value.kind}`);
  }
  return value.value;
};

const unknownReason = (value: StaticValue): string => {
  if (value.kind !== "unknown-primitive") throw new Error(`expected an unknown boolean, received ${value.kind}`);
  return value.reason;
};

const list = (items: StaticValue[], integrity?: StaticValue): StaticListValue => ({
  ...listValue(items),
  integrity,
});

const objectWith = (integrity: StaticValue | undefined, entries: StaticObjectValue["entries"]): StaticObjectValue => ({
  ...objectValue(entries),
  integrity,
});

describe("object integrity", () => {
  it("treats a missing integrity as an extensible object", () => {
    expect(booleanResult(getObjectExtensibility(objectValue()))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(objectValue(), true))).toBe(false);
    expect(booleanResult(getObjectIntegrityTest(objectValue(), false))).toBe(false);
  });

  it("reads extensibility from a concrete integrity level and leaves an unresolved level unknown", () => {
    expect(booleanResult(getObjectExtensibility(objectWith(level("extensible"), [])))).toBe(true);
    expect(booleanResult(getObjectExtensibility(objectWith(level("sealed"), [])))).toBe(false);
    expect(unknownReason(getObjectExtensibility(objectWith(unknownValue("integrity"), [])))).toBe(
      "object extensibility",
    );
  });

  it("advances freeze, seal, and preventExtensions the way Object does", () => {
    const extensible = { integrity: level("extensible") };
    expect(stringResult(getNextObjectIntegrity(extensible, "Object.freeze"))).toBe("frozen");
    expect(stringResult(getNextObjectIntegrity(extensible, "Object.seal"))).toBe("sealed");
    expect(stringResult(getNextObjectIntegrity({ integrity: level("frozen") }, "Object.seal"))).toBe(
      "frozen",
    );
    expect(stringResult(getNextObjectIntegrity(extensible, "Object.preventExtensions"))).toBe(
      "non-extensible",
    );
    expect(
      stringResult(getNextObjectIntegrity({ integrity: level("sealed") }, "Object.preventExtensions")),
    ).toBe("sealed");
    const unresolved = unknownValue("integrity");
    expect(getNextObjectIntegrity({ integrity: unresolved }, "Object.preventExtensions")).toBe(unresolved);
    expect(stringResult(getNextObjectIntegrity({}, "Object.seal"))).toBe("sealed");
  });

  it("answers isSealed and isFrozen from the object's own descriptors", () => {
    const configurable = objectWith(level("non-extensible"), [
      { kind: "property", key: "name", value: primitiveValue("a"), configurable: TRUE_VALUE, writable: TRUE_VALUE },
    ]);
    expect(booleanResult(getObjectIntegrityTest(configurable, false))).toBe(false);
    const writable = objectWith(level("sealed"), [
      { kind: "property", key: "name", value: primitiveValue("a"), configurable: FALSE_VALUE, writable: TRUE_VALUE },
    ]);
    expect(booleanResult(getObjectIntegrityTest(writable, false))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(writable, true))).toBe(false);
    const frozen = objectWith(level("sealed"), [
      { kind: "property", key: "name", value: primitiveValue("a"), configurable: FALSE_VALUE, writable: FALSE_VALUE },
    ]);
    expect(booleanResult(getObjectIntegrityTest(frozen, true))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(objectWith(level("frozen"), []), true))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(objectWith(level("extensible"), []), false))).toBe(false);
    expect(unknownReason(getObjectIntegrityTest(objectWith(unknownValue("integrity"), []), true))).toBe(
      "unresolved object integrity",
    );
    expect(
      unknownReason(
        getObjectIntegrityTest(
          objectWith(level("non-extensible"), [{ kind: "spread", value: unknownValue("props") }]),
          true,
        ),
      ),
    ).toBe("object integrity with unresolved keys");
    expect(
      unknownReason(
        getObjectIntegrityTest(
          objectWith(level("non-extensible"), [
            {
              kind: "spread",
              value: objectValue([
                {
                  kind: "property",
                  key: "name",
                  value: primitiveValue("a"),
                  enumerable: unknownValue("enumerable"),
                },
              ]),
            },
          ]),
          true,
        ),
      ),
    ).toBe("object integrity with unresolved descriptors");
    expect(
      unknownReason(
        getObjectIntegrityTest(
          objectWith(level("sealed"), [
            { kind: "spread", value: primitiveValue("a"), preservesDescriptors: true },
          ]),
          true,
        ),
      ),
    ).toBe("unresolved property integrity");
    const prevented = objectWith(level("non-extensible"), [
      {
        kind: "property",
        key: "name",
        value: primitiveValue("a"),
        configurable: FALSE_VALUE,
        writable: TRUE_VALUE,
      },
    ]);
    expect(booleanResult(getObjectIntegrityTest(prevented, false))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(prevented, true))).toBe(false);
    const accessor = objectWith(level("non-extensible"), [
      {
        kind: "property",
        key: "name",
        value: primitiveValue(undefined),
        configurable: FALSE_VALUE,
        accessor: { get: primitiveValue(null), set: null },
      },
    ]);
    expect(booleanResult(getObjectIntegrityTest(accessor, true))).toBe(true);
    const configurableThenFrozen = objectWith(level("non-extensible"), [
      {
        kind: "property",
        key: "a",
        value: primitiveValue(1),
        configurable: TRUE_VALUE,
        writable: FALSE_VALUE,
      },
      {
        kind: "property",
        key: "b",
        value: primitiveValue(2),
        configurable: FALSE_VALUE,
        writable: FALSE_VALUE,
      },
    ]);
    expect(booleanResult(getObjectIntegrityTest(configurableThenFrozen, false))).toBe(false);
    const absentOrConfigurable = objectWith(level("non-extensible"), [
      {
        kind: "spread",
        preservesDescriptors: true,
        value: branchValue(
          [
            objectValue([
              {
                kind: "property",
                key: "name",
                value: primitiveValue("a"),
                configurable: TRUE_VALUE,
                writable: TRUE_VALUE,
              },
            ]),
            objectValue([]),
          ],
          "own properties",
        ),
      },
    ]);
    expect(getObjectIntegrityTest(absentOrConfigurable, true).kind).toBe("branch");
  });
});

describe("array integrity", () => {
  it("recognizes a frozen array from either the flag or the integrity level", () => {
    expect(isListDefinitelyFrozen(list([]))).toBe(false);
    expect(isListDefinitelyFrozen({ ...list([]), isFrozen: true })).toBe(true);
    expect(isListDefinitelyFrozen(list([], level("frozen")))).toBe(true);
    expect(booleanResult(getListIntegrityTest({ ...list([]), isFrozen: true }, true))).toBe(true);
    expect(booleanResult(getListIntegrityTest({ ...list([]), isFrozen: true }, false))).toBe(false);
  });

  it("matches Object.isSealed and Object.isFrozen for prevented, sealed, and frozen arrays", () => {
    const emptyPrevented = list([], level("non-extensible"));
    expect(booleanResult(getListIntegrityTest(emptyPrevented, false))).toBe(true);
    expect(booleanResult(getListIntegrityTest(emptyPrevented, true))).toBe(true);
    const preventedItem = list([primitiveValue(1)], level("non-extensible"));
    expect(booleanResult(getListIntegrityTest(preventedItem, false))).toBe(false);
    expect(booleanResult(getListIntegrityTest(preventedItem, true))).toBe(false);
    const sealedItem = list([primitiveValue(1)], level("sealed"));
    expect(booleanResult(getListIntegrityTest(sealedItem, false))).toBe(true);
    expect(booleanResult(getListIntegrityTest(sealedItem, true))).toBe(false);
    const named = list([], level("non-extensible"));
    named.properties = new Map([["tag", primitiveValue("x")]]);
    expect(booleanResult(getListIntegrityTest(named, false))).toBe(false);
    const lengthOnly = list([], level("non-extensible"));
    lengthOnly.properties = new Map([["length", primitiveValue(0)]]);
    expect(booleanResult(getListIntegrityTest(lengthOnly, true))).toBe(true);
    const indefinite = list(
      [{ kind: "repeat", item: primitiveValue(1), location: null }],
      level("sealed"),
    );
    expect(unknownReason(getListIntegrityTest(indefinite, true))).toBe(
      "object integrity with unresolved keys",
    );
    expect(unknownReason(getListIntegrityTest(list([], unknownValue("integrity")), true))).toBe(
      "unresolved object integrity",
    );
    expect(booleanResult(getListIntegrityTest(list([], level("extensible")), false))).toBe(false);
    expect(booleanResult(getListIntegrityTest(list([], level("frozen")), false))).toBe(true);
    const branched = list(
      [],
      branchValue([level("extensible"), level("frozen")], "integrity"),
    );
    const branchedTest = getListIntegrityTest(branched, true);
    expect(branchedTest.kind).toBe("branch");
  });

  it("allows writes and deletes only where an array's integrity still permits them", () => {
    const items = list([primitiveValue(1)], level("sealed"));
    expect(booleanResult(getListWritePermission(items, "0"))).toBe(true);
    expect(booleanResult(getListWritePermission(items, "1"))).toBe(false);
    expect(booleanResult(getListDeletePermission(items, "0"))).toBe(false);
    expect(booleanResult(getListDeletePermission(items, "5"))).toBe(true);
    expect(booleanResult(getListDeletePermission(items, "length"))).toBe(false);
    const frozen = list([primitiveValue(1)], level("frozen"));
    expect(booleanResult(getListWritePermission(frozen, "0"))).toBe(false);
    expect(booleanResult(getListDeletePermission(frozen, "0"))).toBe(false);
    const extensible = list([primitiveValue(1)], level("extensible"));
    expect(booleanResult(getListWritePermission(extensible, "9"))).toBe(true);
    expect(booleanResult(getListDeletePermission(extensible, "0"))).toBe(true);
    const open = list([primitiveValue(1)]);
    expect(booleanResult(getListWritePermission(open, "3"))).toBe(true);
    expect(booleanResult(getListExtensibility(open))).toBe(true);
    expect(unknownReason(getListWritePermission(list([], unknownValue("integrity")), "0"))).toBe(
      "unresolved list write",
    );
    const branched = list(
      [primitiveValue(1)],
      branchValue([level("frozen"), level("extensible")], "integrity"),
    );
    expect(getListWritePermission(branched, "0").kind).toBe("branch");
    expect(getListDeletePermission(branched, "0").kind).toBe("branch");
    expect(getListExtensibility(branched).kind).toBe("branch");
    expect(booleanResult(getListExtensibility(list([], level("sealed"))))).toBe(false);
    expect(unknownReason(getListExtensibility(list([], unknownValue("integrity"))))).toBe(
      "object extensibility",
    );
  });
});
