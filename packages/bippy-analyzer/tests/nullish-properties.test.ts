import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "unbound", expected: ["caught"] },
  { name: "assignment", expected: ["caught:1", "returned:1"] },
  { name: "read", expected: ["caught:K", "ready:K"] },
  { name: "write-order", expected: ["caught:KR"] },
  { name: "compound", expected: ["caught:K"] },
  { name: "call", expected: ["caught:K"] },
  { name: "optional", expected: ["undefined:"] },
  { name: "typeof-local", expected: ["caught:TypeError:undefined"] },
  { name: "dynamic", expected: ["caught:TypeError"] },
  { name: "write-error", expected: ["rhs:KR"] },
  { name: "key-error", expected: ["key:K"] },
  { name: "typeof-guards", expected: ["caught", "string"] },
])("preserves nullish property access: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`nullish-properties-${name}.tsx`, expected),
);
