import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "throw", expected: ["caught:1:0"] },
  { name: "guards", expected: ["caught:1:0", "returned:2:1"] },
  { name: "callee", expected: ["caught:1", "returned:2"] },
  { name: "optional", expected: ["missing:0:none", "present:1:value"] },
  { name: "receiver", expected: ["first:value:1:1", "second:value:1:1"] },
  { name: "receiver-throw", expected: ["caught:B", "returned:BKGAC"] },
  { name: "key-throw", expected: ["caught:K", "returned:KAC"] },
  { name: "spread-throw", expected: ["1,2,3:2", "caught:1"] },
  { name: "spread-arity", expected: ["1:3:1", "3:1,2,3:1"] },
  { name: "constructor", expected: ["caught:1:0", "returned:2:1"] },
  { name: "errors", expected: ["first:1:0", "second:2:0"] },
])("preserves $name argument evaluation", ({ name, expected }) =>
  checkConcreteComponentStates(`argument-order-${name}.tsx`, expected),
);
