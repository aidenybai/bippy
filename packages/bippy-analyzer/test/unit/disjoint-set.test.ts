/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/__tests__/DisjointSet-test.ts at b618bbb.

import { describe, expect, it } from "vite-plus/test";
import { DisjointSet } from "../../src/compiler/utils/disjoint-set.js";

interface TestIdentifier {
  id: number;
  name: string;
}

const makeIdentifiers = (...names: string[]): TestIdentifier[] =>
  names.map((name, id) => ({ id, name }));

describe("DisjointSet", () => {
  it(".find - finds the correct region which the item is associated with", () => {
    const identifiers = new DisjointSet<TestIdentifier>();
    const [x, y, z] = makeIdentifiers("x", "y", "z");

    identifiers.union([x]);
    identifiers.union([y, x]);

    expect(identifiers.find(x)).toBe(y);
    expect(identifiers.find(y)).toBe(y);
    expect(identifiers.find(z)).toBe(null);
  });

  it(".forEach - regions items into non-overlapping sets", () => {
    const identifiers = new DisjointSet<TestIdentifier>();
    const [a, b, c, x, y, z] = makeIdentifiers("a", "b", "c", "x", "y", "z");

    identifiers.union([a]);
    identifiers.union([b, a]);
    identifiers.union([c, b]);

    identifiers.union([x]);
    identifiers.union([y, x]);
    identifiers.union([z, y]);
    identifiers.union([x, z]);

    const sets = new Map<TestIdentifier, string[]>();
    identifiers.forEach((item, region) =>
      sets.set(region, [...(sets.get(region) ?? []), item.name]),
    );
    expect([...sets.values()]).toEqual([
      ["a", "b", "c"],
      ["x", "y", "z"],
    ]);
  });

  // Regression test for issue #933
  it("`forEach` doesn't infinite loop when there are cycles", () => {
    const identifiers = new DisjointSet<TestIdentifier>();
    const [x, y, z] = makeIdentifiers("x", "y", "z");

    identifiers.union([x]);
    identifiers.union([y, x]);
    identifiers.union([z, y]);
    identifiers.union([x, z]);

    identifiers.forEach((_, region) => expect(region).toBe(z));
  });
});
