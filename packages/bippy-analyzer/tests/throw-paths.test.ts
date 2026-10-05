import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each(["direct", "call", "quantifier", "heap", "declarations", "fallthrough", "return-heap"])(
  "preserves caught path state for %s",
  (name) => checkConcreteComponentStates(`throw-path-${name}.tsx`, ["caught:1", "returned:2"]),
);

it.each(["finally", "nested-finally"])("preserves updates through %s", (name) =>
  checkConcreteComponentStates(`throw-path-${name}.tsx`, ["caught:11", "returned:12"]),
);

it("preserves early return state through finally", () =>
  checkConcreteComponentStates("throw-path-return-finally.tsx", ["early:11", "late:12"]));

it("preserves state while rethrowing to an outer handler", () =>
  checkConcreteComponentStates("throw-path-rethrow.tsx", ["caught:11", "returned:2"]));

it("lets a finalizer failure replace a return", () =>
  checkConcreteComponentStates("throw-path-finalizer-failure.tsx", ["caught:2", "returned:1"]));

it.each(["payloads", "heap-payloads"])("keeps %s with their throwing states", (name) =>
  checkConcreteComponentStates(`throw-path-${name}.tsx`, ["first:1", "returned:3", "second:2"]),
);
