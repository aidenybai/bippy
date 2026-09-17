import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "number-read", expected: ["caught"] },
  { name: "number-write", expected: ["caught:old"] },
  { name: "typed-read", expected: ["type-error"] },
  { name: "object", expected: ["caught:0"] },
  { name: "guards", expected: ["caught:G", "returned:GT"] },
  { name: "write-order", expected: ["caught:KRG:old"] },
  { name: "bound", expected: ["bound"] },
  { name: "null", expected: ["new"] },
  { name: "object-proxy", expected: ["caught:0"] },
  { name: "function-proxy", expected: ["ready"] },
])("checks proxy trap callability: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`proxy-methods-${name}.tsx`, expected),
);
