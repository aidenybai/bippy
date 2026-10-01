import { describe, expect, it } from "vite-plus/test";
import {
  getNextObjectIntegrity,
  getObjectExtensibility,
  getObjectIntegrityTest,
} from "../src/evaluate/object-integrity.js";
import {
  branchValue,
  FALSE_VALUE,
  objectValue,
  primitiveValue,
  TRUE_VALUE,
  unknownValue,
} from "../src/evaluate/values.js";
import type { StaticObjectValue, StaticValue } from "../src/types.js";

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
  if (value.kind !== "unknown-primitive")
    throw new Error(`expected an unknown boolean, received ${value.kind}`);
  return value.reason;
};

const objectWith = (
  integrity: StaticValue | undefined,
  entries: StaticObjectValue["entries"],
): StaticObjectValue => ({
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
    const extensible = objectWith(level("extensible"), []);
    expect(stringResult(getNextObjectIntegrity(extensible, "Object.freeze"))).toBe("frozen");
    expect(stringResult(getNextObjectIntegrity(extensible, "Object.seal"))).toBe("sealed");
    expect(
      stringResult(getNextObjectIntegrity(objectWith(level("frozen"), []), "Object.seal")),
    ).toBe("frozen");
    expect(stringResult(getNextObjectIntegrity(extensible, "Object.preventExtensions"))).toBe(
      "non-extensible",
    );
    expect(
      stringResult(
        getNextObjectIntegrity(objectWith(level("sealed"), []), "Object.preventExtensions"),
      ),
    ).toBe("sealed");
    const unresolved = unknownValue("integrity");
    expect(getNextObjectIntegrity(objectWith(unresolved, []), "Object.preventExtensions")).toBe(
      unresolved,
    );
    expect(stringResult(getNextObjectIntegrity(objectValue(), "Object.seal"))).toBe("sealed");
  });

  it("answers isSealed and isFrozen from the object's own descriptors", () => {
    const configurable = objectWith(level("non-extensible"), [
      {
        kind: "property",
        key: "name",
        value: primitiveValue("a"),
        configurable: TRUE_VALUE,
        writable: TRUE_VALUE,
      },
    ]);
    expect(booleanResult(getObjectIntegrityTest(configurable, false))).toBe(false);
    const writable = objectWith(level("sealed"), [
      {
        kind: "property",
        key: "name",
        value: primitiveValue("a"),
        configurable: FALSE_VALUE,
        writable: TRUE_VALUE,
      },
    ]);
    expect(booleanResult(getObjectIntegrityTest(writable, false))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(writable, true))).toBe(false);
    const frozen = objectWith(level("sealed"), [
      {
        kind: "property",
        key: "name",
        value: primitiveValue("a"),
        configurable: FALSE_VALUE,
        writable: FALSE_VALUE,
      },
    ]);
    expect(booleanResult(getObjectIntegrityTest(frozen, true))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(objectWith(level("frozen"), []), true))).toBe(true);
    expect(booleanResult(getObjectIntegrityTest(objectWith(level("extensible"), []), false))).toBe(
      false,
    );
    expect(
      unknownReason(getObjectIntegrityTest(objectWith(unknownValue("integrity"), []), true)),
    ).toBe("unresolved object integrity");
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
