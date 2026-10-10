import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { compareProject } from "./compare.js";
import type { FunctionComparison } from "./compare.js";

interface IntentionalDifference {
  name: string;
  reason: string;
}

const CONFIG_PATH = fileURLToPath(
  new URL("../unit/fixtures/compiler-port/tsconfig.json", import.meta.url),
);

/**
 * Functions we compile on purpose though upstream does not. Upstream's `getFunctionName`
 * names `Foo = () => {}`, `{useFoo: () => {}}`, and `const {useFoo = () => {}} = {}` only
 * behind checks that compare a `NodePath` from `parent.get(...)`, which never pass.
 */
const INTENTIONAL_DIFFERENCES: IntentionalDifference[] = [
  {
    name: "Reassigned",
    reason: "A function assigned with `=` is named after its target.",
  },
];

describe("compiler port matches babel-plugin-react-compiler on port regressions", () => {
  let comparisons: FunctionComparison[] = [];

  beforeAll(() => {
    comparisons = compareProject(CONFIG_PATH, { fileFilter: null, isTypeProviderEnabled: false });
  });

  it("finds the components and hooks upstream compiles", () => {
    expect(comparisons.map((comparison) => comparison.name).toSorted()).toEqual([
      "<anonymous>",
      "CapturedContext",
      "Counter",
      "DestructuringTarget",
      "EnumComponent",
      "Forwarded",
      "Memoized",
      "Reassigned",
      "default",
      "optedIn",
    ]);
  });

  it("prints the same HIR after InferReactivePlaces", () => {
    const unexpected = comparisons.filter(
      (comparison) =>
        comparison.status !== "match" &&
        !INTENTIONAL_DIFFERENCES.some((difference) => difference.name === comparison.name),
    );
    expect(
      unexpected.map(
        (comparison) => `${comparison.name}\n${comparison.patch ?? comparison.status}`,
      ),
    ).toEqual([]);
  });

  it.each(INTENTIONAL_DIFFERENCES)("compiles $name where upstream does not", (difference) => {
    expect(comparisons.find((comparison) => comparison.name === difference.name)?.status).toBe(
      "port-only",
    );
  });
});
