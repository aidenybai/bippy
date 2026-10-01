import { expect, it } from "vite-plus/test";
import { createScope } from "../src/evaluate/scope.js";
import { joinScopes, restoreScopes, snapshotScopes } from "../src/evaluate/scope-journal.js";
import { primitiveValue } from "../src/evaluate/values.js";

it("snapshots distinct caller and callback chains once without changing root policy", () => {
  const root = createScope(null);
  const shared = createScope(root);
  const caller = createScope(shared);
  const callback = createScope(shared);
  for (const scope of [root, shared, caller, callback])
    scope.bindings.set("count", primitiveValue(0));
  const snapshots = snapshotScopes(caller, callback);
  expect(snapshots.map((snapshot) => snapshot.scope)).toEqual([caller, shared, callback]);
  for (const scope of [root, shared, caller, callback])
    scope.bindings.set("count", primitiveValue(1));
  restoreScopes(snapshots);
  for (const scope of [shared, caller, callback])
    expect(scope.bindings.get("count")).toEqual(primitiveValue(0));
  expect(root.bindings.get("count")).toEqual(primitiveValue(1));
  expect(snapshotScopes(caller, caller)).toHaveLength(2);
});
it("joins both scope chains with consistent alternatives and preferences", () => {
  const root = createScope(null);
  const caller = createScope(root);
  const callback = createScope(root);
  const paths = [0, 1].map((index) => {
    caller.bindings.set("count", primitiveValue(index));
    callback.bindings.set("count", primitiveValue(index + 2));
    return snapshotScopes(caller, callback);
  });
  joinScopes(paths, "paths", null, 1, null);
  for (const [index, scope] of [caller, callback].entries()) {
    const value = scope.bindings.get("count");
    if (value?.kind !== "branch") throw new Error("Expected joined scope value");
    expect(value.preferredIndex).toBe(1);
    expect(value.alternatives).toEqual([primitiveValue(index * 2), primitiveValue(index * 2 + 1)]);
  }
});
