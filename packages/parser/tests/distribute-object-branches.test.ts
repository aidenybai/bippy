import { describe, expect, it } from "vite-plus/test";
import type { StaticValue } from "../src/types.js";
import {
  branchValue,
  distributeObjectBranches,
  getObjectProperty,
  listValue,
  objectFromRecord,
  primitiveValue,
  toJsonValue,
} from "../src/evaluate/values.js";

const text = (value: string) => primitiveValue(value);

const eitherHref = (predicate: string | null = "truthy(isDark)") =>
  branchValue([text("/dark.png"), text("/light.png")], "theme", null, 1, predicate);

/** Each alternative as JSON, or the whole value when nothing was distributed. */
const alternativesOf = (value: StaticValue): string[] =>
  (value.kind === "branch" ? value.alternatives : [value]).map((alternative) =>
    JSON.stringify(toJsonValue(alternative)),
  );

describe("distributeObjectBranches", () => {
  it("returns values without nested branches untouched", () => {
    const link = objectFromRecord({ rel: text("icon"), href: text("/icon.png") });
    expect(distributeObjectBranches(link)).toBe(link);
    const links = listValue([link]);
    expect(distributeObjectBranches(links)).toBe(links);
    const branch = eitherHref();
    expect(distributeObjectBranches(branch)).toBe(branch);
  });

  it("hoists a branch nested in an object into a branch of concrete objects", () => {
    const distributed = distributeObjectBranches(
      objectFromRecord({ rel: text("icon"), href: eitherHref() }),
    );
    expect(alternativesOf(distributed)).toEqual([
      '{"rel":"icon","href":"/dark.png"}',
      '{"rel":"icon","href":"/light.png"}',
    ]);
    expect(distributed.kind === "branch" && distributed.predicate).toBe("truthy(isDark)");
    expect(distributed.kind === "branch" && distributed.preferredIndex).toBe(1);
    expect(distributed.kind === "branch" && distributed.reason).toBe("theme");
  });

  it("hoists branches through nested lists and objects", () => {
    const distributed = distributeObjectBranches(
      listValue([
        objectFromRecord({ rel: text("stylesheet"), href: text("/app.css") }),
        objectFromRecord({ rel: text("icon"), href: eitherHref() }),
      ]),
    );
    expect(alternativesOf(distributed)).toEqual([
      '[{"rel":"stylesheet","href":"/app.css"},{"rel":"icon","href":"/dark.png"}]',
      '[{"rel":"stylesheet","href":"/app.css"},{"rel":"icon","href":"/light.png"}]',
    ]);
  });

  it("takes the cartesian product of independent decisions", () => {
    const distributed = distributeObjectBranches(
      objectFromRecord({
        theme: branchValue([text("dark"), text("light")], "theme", null, 0, "truthy(isDark)"),
        size: branchValue([text("sm"), text("lg")], "size", null, 0, "truthy(isLarge)"),
      }),
    );
    expect(alternativesOf(distributed)).toEqual([
      '{"theme":"dark","size":"sm"}',
      '{"theme":"dark","size":"lg"}',
      '{"theme":"light","size":"sm"}',
      '{"theme":"light","size":"lg"}',
    ]);
    expect(distributed.kind === "branch" && distributed.predicate).toBeNull();
  });

  it("keeps repeated occurrences of one predicate correlated", () => {
    const distributed = distributeObjectBranches(
      objectFromRecord({
        icon: eitherHref(),
        nested: listValue([
          objectFromRecord({
            label: branchValue([text("Dark"), text("Light")], "theme", null, 1, "truthy(isDark)"),
          }),
        ]),
      }),
    );
    expect(alternativesOf(distributed)).toEqual([
      '{"icon":"/dark.png","nested":[{"label":"Dark"}]}',
      '{"icon":"/light.png","nested":[{"label":"Light"}]}',
    ]);
    expect(distributed.kind === "branch" && distributed.predicate).toBe("truthy(isDark)");
    expect(distributed.kind === "branch" && distributed.preferredIndex).toBe(1);
  });

  it("treats the same predicate-less branch value as one decision", () => {
    const shared = eitherHref(null);
    expect(alternativesOf(distributeObjectBranches(listValue([shared, shared])))).toEqual([
      '["/dark.png","/dark.png"]',
      '["/light.png","/light.png"]',
    ]);
  });

  it("distributes deeply nested correlated branches in polynomial time", () => {
    const depth = 24;
    let nested: StaticValue = objectFromRecord({ icon: eitherHref() });
    for (let level = 0; level < depth; level++) {
      nested = objectFromRecord({ icon: eitherHref(), children: listValue([nested, nested]) });
    }
    const readLeafIcons = (value: StaticValue): string[] => {
      const icon = value.kind === "object" ? getObjectProperty(value, "icon") : null;
      const children = value.kind === "object" ? getObjectProperty(value, "children") : null;
      return [
        ...(icon?.kind === "primitive" ? [String(icon.value)] : []),
        ...(children?.kind === "list" ? readLeafIcons(children.items[0]) : []),
      ];
    };
    const startedAt = performance.now();
    const distributed = distributeObjectBranches(nested);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(distributed.kind === "branch" && distributed.predicate).toBe("truthy(isDark)");
    expect(distributed.kind === "branch" && distributed.preferredIndex).toBe(1);
    expect(distributed.kind === "branch" && distributed.alternatives.map(readLeafIcons)).toEqual([
      Array.from({ length: depth + 1 }, () => "/dark.png"),
      Array.from({ length: depth + 1 }, () => "/light.png"),
    ]);
  });

  it("returns the value unchanged once the product exceeds the limit", () => {
    const wide = objectFromRecord({
      first: branchValue([text("a"), text("b")], "first", null, 0, "truthy(a)"),
      second: branchValue([text("c"), text("d")], "second", null, 0, "truthy(b)"),
      third: branchValue([text("e"), text("f")], "third", null, 0, "truthy(c)"),
    });
    expect(distributeObjectBranches(wide, 4)).toBe(wide);
    expect(alternativesOf(distributeObjectBranches(wide, 8))).toHaveLength(8);
  });
});
