import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it("guards the callee's effects with successful arguments", () =>
  checkConcreteComponentStates("call-argument-throw-guards.tsx", ["caught:0", "returned:1"]));
it("preserves the first argument that throws", () =>
  checkConcreteComponentStates("call-argument-throw-order.tsx", ["first", "second"]));
