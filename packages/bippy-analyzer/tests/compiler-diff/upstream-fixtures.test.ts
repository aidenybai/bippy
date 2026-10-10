import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { compareProject } from "./compare.js";
import type { FunctionComparison } from "./compare.js";

interface KnownDifferences {
  reason: string;
  functions: string[];
}

const FIXTURES_DIRECTORY = fileURLToPath(new URL("fixtures", import.meta.url));

/**
 * Every fixture function where the two compilers disagree, as `status name file:end`. Against
 * a build of the ported commit, only the last three groups remain.
 */
const KNOWN_DIFFERENCES: KnownDifferences[] = [
  {
    reason:
      "The newest npm build, 0.0.0-experimental-a1856f3-20260507, predates the ported commit. It types impure globals such as `Date` and timers differently, compiles `using` declarations and implicit `arguments`, and lacks later fixes to lowering and reactivity.",
    functions: [
      "mismatch Component compiler/error.invalid-impure-functions-in-render.js:8:1",
      "mismatch Component compiler/error.invalid-mutate-props-in-effect-fixpoint.js:16:1",
      "mismatch Component compiler/error.invalid-new-date-in-render.js:8:1",
      "mismatch Component compiler/error.invalid-update-expression-context-variable-in-effect.js:25:1",
      "mismatch Component compiler/for-loop-with-value-block-initializer.js:9:1",
      "mismatch Component compiler/jsx-underscore-prefix-component.js:11:1",
      "mismatch Component compiler/new-mutability/error.invalid-impure-functions-in-render.js:8:1",
      "mismatch Component compiler/new-mutability/error.invalid-new-date-in-render.js:8:1",
      "mismatch Component compiler/new-mutability/valid-new-date-from-timestamp.js:6:1",
      "mismatch Component compiler/primitive-reassigned-loop-force-scopes-enabled.js:8:1",
      "mismatch Component compiler/rules-of-hooks/error.invalid-hook-for.js:7:1",
      "mismatch Component compiler/timers.js:10:1",
      "mismatch Component compiler/valid-new-date-from-timestamp.js:6:1",
      "port-bailed Component compiler/error.todo-await-using-declaration.js:4:1",
      "port-bailed Component compiler/error.todo-using-declaration.js:4:1",
      "port-bailed Component compiler/error.unsupported-implicit-arguments.js:3:1",
      "port-bailed Component compiler/implicit-arguments-bailout-preserves-renders.js:5:1",
      "port-bailed ComponentWithUsing compiler/using-declaration-bailout-sibling-compiles.js:5:1",
      "upstream-bailed Component compiler/todo-jsx-intrinsic-tag-matches-local-binding.js:18:1",
    ],
  },
  {
    reason:
      "A function assigned with `=` or given as a destructuring default is named after its target, so we compile it. Upstream's `getFunctionName` names these only behind checks that never pass.",
    functions: [
      "port-only Foo compiler/gating/invalid-fnexpr-reference.js:6:35",
      "port-only Foo compiler/gating/reassigned-fnexpr-variable.js:9:37",
      "port-only Namespace.useHook compiler/rules-of-hooks/todo.bail.rules-of-hooks-e0a5db3ae21e.js:40:1",
      "port-only useHook compiler/rules-of-hooks/todo.bail.rules-of-hooks-e0a5db3ae21e.js:21:3",
      "port-only useHook2 compiler/rules-of-hooks/todo.bail.rules-of-hooks-e0a5db3ae21e.js:17:1",
      "port-only useHook3 compiler/rules-of-hooks/todo.bail.rules-of-hooks-e0a5db3ae21e.js:31:3",
    ],
  },
  {
    reason:
      "These fixtures record upstream bugs in Babel's scope analysis: a destructured `catch` parameter has no binding, and a `useState` setter is referenced as both a local and a context variable. TypeScript's binder handles both.",
    functions: [
      "upstream-bailed Foo compiler/error.bug-invariant-couldnt-find-binding-for-decl.js:11:1",
      "upstream-bailed useFoot compiler/error.bug-invariant-local-or-context-references.js:18:1",
    ],
  },
  {
    reason:
      "We don't port Flow suppression detection, since we only read TypeScript and JavaScript.",
    functions: ["upstream-bailed Foo compiler/error.bailout-on-flow-suppression.js:7:1"],
  },
];

const AGREEING_STATUSES = new Set(["match", "both-bailed"]);

const describeComparison = (comparison: FunctionComparison): string =>
  `${comparison.status} ${comparison.name} ${relative(FIXTURES_DIRECTORY, comparison.file)}:${comparison.key}`;

describe("compiler port matches babel-plugin-react-compiler on the compiler's own fixtures", () => {
  let comparisons: FunctionComparison[] = [];

  beforeAll(() => {
    comparisons = compareProject(`${FIXTURES_DIRECTORY}/tsconfig.json`, {
      fileFilter: null,
      isTypeProviderEnabled: false,
    });
  });

  it("prints the same HIR for 941 functions", () => {
    expect(comparisons.filter((comparison) => comparison.status === "match").length).toBe(941);
  });

  it("differs only where known", () => {
    expect(
      comparisons
        .filter((comparison) => !AGREEING_STATUSES.has(comparison.status))
        .map(describeComparison)
        .toSorted(),
    ).toEqual(KNOWN_DIFFERENCES.flatMap((differences) => differences.functions).toSorted());
  });
});
