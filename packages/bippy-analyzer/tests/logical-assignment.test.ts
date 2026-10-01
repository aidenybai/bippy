import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it("skips the RHS of a truthy OR assignment", () =>
  checkConcreteComponentStates("logical-assignment-or.tsx", ["kept:old:0", "set:new:1"]));
it.each(["and", "nullish"])("skips the RHS of a kept %s assignment", (name) =>
  checkConcreteComponentStates(`logical-assignment-${name}.tsx`, ["kept::0", "set:new:1"]),
);
it("leaves the target unchanged when the RHS throws", () =>
  checkConcreteComponentStates("logical-assignment-throws.tsx", ["caught::1", "returned:new:1"]));
it("does not invoke a skipped throwing RHS", () =>
  checkConcreteComponentStates("logical-assignment-skipped-throw.tsx", [
    "caught::1",
    "kept:old:0",
  ]));
it("does not evaluate the RHS after a getter throws", () =>
  checkConcreteComponentStates("logical-assignment-getter-throw.tsx", [
    "caught:1:0",
    "returned:1:0",
  ]));
it("keeps false but replaces undefined in a nullish assignment", () =>
  checkConcreteComponentStates("logical-assignment-false.tsx", ["no:0", "yes:1"]));
it("guards object and list mutations in the RHS", () =>
  checkConcreteComponentStates("logical-assignment-heap.tsx", ["new:1:1", "old:0:0"]));
it("preserves the kept object's identity", () =>
  checkConcreteComponentStates("logical-assignment-identity.tsx", ["new:1", "same:0"]));
it("preserves an unknown boolean's short-circuit guard", () =>
  checkConcreteComponentStates("logical-assignment-boolean.tsx", ["ready:0", "ready:1"]));
