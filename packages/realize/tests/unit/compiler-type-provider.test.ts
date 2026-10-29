import { SymbolFlags } from "typescript/unstable/sync";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { isProjectSourceFile } from "../../src/core/project/is-project-source-file";
import { withProject } from "../../src/core/project/with-project";
import type { MutableCollection } from "../../src/react-compiler/HIR/Environment";
import { Effect, ValueKind } from "../../src/react-compiler/HIR/HIR";
import type { HIRFunction, Type } from "../../src/react-compiler/HIR/HIR";
import {
  BuiltInArrayId,
  BuiltInMapId,
  BuiltInMixedReadonlyId,
  BuiltInSetId,
} from "../../src/react-compiler/HIR/ObjectShape";
import { CompilerTypeProvider } from "../../src/core/type-checker/type-provider";
import { getFixtureConfig, getLocalTypesByName, getHirFunctionsByName } from "./helpers";

const COLLECTIONS: MutableCollection[] = ["Array", "Map", "Set"];
const SYMBOL_MEMBER_PREFIX = "__@";

interface CollectionMembers {
  all: string[];
  mutating: string[];
}

const getMutatingMembers = (): Map<MutableCollection, CollectionMembers> =>
  withProject(getFixtureConfig("types"), (project) => {
    const sourceFile = project.program
      .getSourceFileNames()
      .filter(isProjectSourceFile)
      .map((fileName) => project.program.getSourceFile(fileName))
      .find((candidate) => candidate !== undefined);
    if (!sourceFile) throw new Error("The types fixture has no source file");
    const provider = new CompilerTypeProvider(project.checker, sourceFile);
    return new Map(
      COLLECTIONS.map((collection) => {
        const symbol = project.checker.resolveName(collection, SymbolFlags.Type, sourceFile);
        const all = symbol
          ? project.checker
              .getPropertiesOfType(project.checker.getDeclaredTypeOfSymbol(symbol))
              .map((property) => property.name)
          : [];
        return [
          collection,
          {
            all,
            mutating: all.filter(
              (name) =>
                !name.startsWith(SYMBOL_MEMBER_PREFIX) &&
                provider.isMutatingMethod(collection, name),
            ),
          },
        ];
      }),
    );
  });

describe("CompilerTypeProvider.isMutatingMethod", () => {
  let members = new Map<MutableCollection, { all: string[]; mutating: string[] }>();

  beforeAll(() => {
    members = getMutatingMembers();
  });

  it("derives exactly the in-place Array methods", () => {
    expect(members.get("Array")?.mutating.toSorted()).toEqual(
      [
        "copyWithin",
        "fill",
        "pop",
        "push",
        "reverse",
        "shift",
        "sort",
        "splice",
        "unshift",
      ].toSorted(),
    );
  });

  it("derives exactly the in-place Map methods", () => {
    expect(members.get("Map")?.mutating.toSorted()).toEqual([
      "clear",
      "delete",
      "getOrInsert",
      "getOrInsertComputed",
      "set",
    ]);
  });

  it("derives exactly the in-place Set methods", () => {
    expect(members.get("Set")?.mutating.toSorted()).toEqual(["add", "clear", "delete"]);
  });

  it("checks against the full member lists", () => {
    expect(members.get("Array")?.all).toEqual(
      expect.arrayContaining(["map", "filter", "slice", "toSorted", "toReversed", "with"]),
    );
    expect(members.get("Map")?.all).toEqual(expect.arrayContaining(["get", "has", "forEach"]));
    expect(members.get("Set")?.all).toEqual(expect.arrayContaining(["has", "forEach"]));
  });

  it("calls copying and reading methods non-mutating", () => {
    const array = members.get("Array")?.mutating ?? [];
    for (const method of ["map", "filter", "slice", "toSorted", "toReversed", "toSpliced", "with"])
      expect(array).not.toContain(method);
    expect(members.get("Map")?.mutating).not.toContain("get");
    expect(members.get("Map")?.mutating).not.toContain("has");
    expect(members.get("Set")?.mutating).not.toContain("has");
  });
});

describe("CompilerTypeProvider.getType", () => {
  let typed: HIRFunction;
  let types = new Map<string, Type>();

  const getType = (name: string): Type => {
    const type = types.get(name);
    if (!type) throw new Error(`No local named ${name}`);
    return type;
  };

  const getSignature = (name: string) => {
    const type = getType(name);
    return type.kind === "Function" ? typed.env.getFunctionSignature(type) : null;
  };

  beforeAll(() => {
    const functions = getHirFunctionsByName("types");
    const hirFunction = functions.get("Typed");
    if (!hirFunction) throw new Error("Typed was not lowered");
    typed = hirFunction;
    types = getLocalTypesByName(hirFunction);
  });

  it.each(["label", "count", "mode", "isActive", "maybeLabel"])(
    "types %s as a primitive",
    (name) => {
      expect(getType(name)).toEqual({ kind: "Primitive" });
    },
  );

  it.each(["list", "pair", "maybeList"])("types %s as an array", (name) => {
    expect(getType(name)).toMatchObject({ kind: "Object", shapeId: BuiltInArrayId });
  });

  it.each(["frozenList", "frozenMap", "frozenSet"])("types %s as readonly", (name) => {
    expect(getType(name)).toMatchObject({ kind: "Object", shapeId: BuiltInMixedReadonlyId });
  });

  it("types Map and Set with the compiler's shapes", () => {
    expect(getType("lookup")).toMatchObject({ kind: "Object", shapeId: BuiltInMapId });
    expect(getType("tags")).toMatchObject({ kind: "Object", shapeId: BuiltInSetId });
  });

  it.each(["loose", "opaque", "either", "overloaded"])("leaves %s untyped", (name) => {
    expect(getType(name).kind).toBe("Type");
  });

  it("reads primitive parameters and returns a primitive", () => {
    expect(getSignature("format")).toMatchObject({
      positionalParams: [Effect.Read],
      restParam: null,
      returnType: { kind: "Primitive" },
      returnValueKind: ValueKind.Primitive,
      calleeEffect: Effect.Read,
    });
  });

  it("may mutate object parameters", () => {
    expect(getSignature("consume")).toMatchObject({
      positionalParams: [Effect.ConditionallyMutate],
    });
  });

  it("reads readonly collection parameters", () => {
    expect(getSignature("measure")).toMatchObject({
      positionalParams: [Effect.Read],
      returnValueKind: ValueKind.Primitive,
    });
  });

  it("types the return of a function returning an object but keeps the unknown-call signature", () => {
    expect(getType("makeList")).toMatchObject({
      kind: "Function",
      shapeId: null,
      return: { kind: "Object", shapeId: BuiltInArrayId },
    });
    expect(getType("freeze")).toMatchObject({
      kind: "Function",
      shapeId: null,
      return: { kind: "Object", shapeId: BuiltInMixedReadonlyId },
    });
    expect(getSignature("pick")).toBeNull();
  });

  it("treats a readonly collection of objects as mutable, since readonly is shallow", () => {
    expect(getType("frozenItems")).toMatchObject({ kind: "Object", shapeId: BuiltInArrayId });
  });

  it("strips undefined from an optional callback", () => {
    expect(getSignature("onClose")).toMatchObject({
      positionalParams: [],
      returnValueKind: ValueKind.Primitive,
    });
  });

  it("types a readonly tuple as readonly", () => {
    expect(getType("fixedPair")).toMatchObject({ kind: "Object", shapeId: BuiltInMixedReadonlyId });
  });
});
