import { expect, it } from "vite-plus/test";
import { hasNamedProperty } from "../src/evaluate/has-property.js";
import { createPathPredicate, getAlternativeGuards } from "../src/evaluate/predicates.js";
import type { StaticObjectEntry } from "../src/types.js";
import {
  branchValue,
  FALSE_VALUE,
  getKnownObjectKeys,
  getObjectProperty,
  getSpreadEntries,
  joinObjectEntries,
  objectFromRecord,
  objectValue,
  omitRestKeys,
  primitiveValue,
  setObjectProperty,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownValue,
} from "../src/evaluate/values.js";

it("retains the predicate for a deleted undefined-valued property", () => {
  const original = objectFromRecord({ value: UNDEFINED_VALUE });
  const predicate = createPathPredicate("delete", null);
  const joined = objectValue(
    joinObjectEntries(original.entries, [[], original.entries], "delete", null, 1, predicate),
  );
  expect(hasNamedProperty("value", joined)).toMatchObject({
    kind: "branch",
    predicate,
    preferredIndex: 1,
    alternatives: [FALSE_VALUE, TRUE_VALUE],
  });
  expect(getObjectProperty(joined, "value")).toEqual(UNDEFINED_VALUE);
  expect(getKnownObjectKeys(joined)).toBeNull();
});

it("does not resurrect the original key after spread-shape changes", () => {
  const original = objectValue([
    { kind: "spread", value: objectFromRecord({ value: primitiveValue("old") }) },
  ]);
  const joined = objectValue(
    joinObjectEntries(original.entries, [[], []], "delete", null, 0, null),
  );
  expect(hasNamedProperty("value", joined)).toEqual(FALSE_VALUE);
  expect(getObjectProperty(joined, "value")).toEqual(UNDEFINED_VALUE);
  expect(getKnownObjectKeys(joined)).toEqual([]);
});

it("snapshots conditional spread values without adding absent keys", () => {
  const present = objectFromRecord({ value: primitiveValue("first") });
  const predicate = createPathPredicate("spread", null);
  const source = branchValue([present, objectValue([])], "spread", null, 0, predicate);
  const entries = getSpreadEntries(source);
  expect(entries).not.toBeNull();
  if (!entries) throw new Error("Missing finite spread entries");
  const copied = objectValue(entries);
  setObjectProperty(present, "value", primitiveValue("later"));
  expect(hasNamedProperty("value", copied)).toMatchObject({
    kind: "branch",
    predicate,
    alternatives: [TRUE_VALUE, FALSE_VALUE],
  });
  const copiedValue = getObjectProperty(copied, "value");
  expect(copiedValue).toMatchObject({
    kind: "branch",
    alternatives: [primitiveValue("first"), UNDEFINED_VALUE],
  });
  if (source.kind !== "branch" || copiedValue.kind !== "branch")
    throw new Error("Expected guarded source and copied values");
  expect(getAlternativeGuards(copiedValue)).toEqual(getAlternativeGuards(source));
});

it("retains the source reason through a nested unknown spread", () => {
  const source = objectValue([{ kind: "spread", value: unknownValue("source shape") }]);
  const wrapped = objectValue([{ kind: "spread", value: source }]);
  expect(getObjectProperty(wrapped, "value")).toEqual(getObjectProperty(source, "value"));
});

it("keeps explicit undefined over an earlier spread value", () => {
  const target = objectValue([
    { kind: "property", key: "value", value: primitiveValue("old") },
    { kind: "spread", value: objectFromRecord({ value: UNDEFINED_VALUE }) },
  ]);
  expect(getObjectProperty(target, "value")).toEqual(UNDEFINED_VALUE);
  expect(getKnownObjectKeys(target)).toEqual(["value"]);
});

it("keeps omitted rest keys out of an opaque spread", () => {
  const rest = omitRestKeys(
    objectValue([
      { kind: "spread", value: unknownValue("source shape") },
      { kind: "property", key: "children", value: primitiveValue("source") },
    ]),
    new Set(["children"]),
  );
  const target = objectValue([
    { kind: "property", key: "children", value: primitiveValue("kept") },
    { kind: "spread", value: rest },
  ]);
  expect(getObjectProperty(target, "children")).toEqual(primitiveValue("kept"));
});

it("lifts properties shared by every whole-object join path", () => {
  const children = primitiveValue("kept");
  const original: StaticObjectEntry[] = [
    { kind: "property", key: "children", value: children },
  ];
  const joined = objectValue(
    joinObjectEntries(
      original,
      [
        original,
        [
          ...original,
          {
            kind: "spread",
            value: unknownValue("other loop keys"),
            omittedKeys: ["children"],
          },
        ],
      ],
      "loop iterations are uncertain",
      null,
      0,
      null,
    ),
  );
  expect(getObjectProperty(joined, "children")).toBe(children);
});
