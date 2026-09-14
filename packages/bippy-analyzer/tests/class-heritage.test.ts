import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "write", expected: ["caught"] },
  { name: "declaration", expected: ["caught:parent:H"] },
  { name: "expression", expected: ["caught:old"] },
  { name: "guards", expected: ["caught:H", "returned:HKSA"] },
  { name: "arguments", expected: ["caught:H"] },
  { name: "payloads", expected: ["null", "undefined"] },
  { name: "bases", expected: ["first:1", "second:1"] },
  { name: "plain", expected: ["KSAI"] },
  { name: "null", expected: ["ready"] },
])("preserves class heritage completion: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`class-heritage-${name}.tsx`, expected),
);
