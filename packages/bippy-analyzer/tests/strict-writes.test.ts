import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "getter", expected: ["caught:old"] },
  { name: "proxy", expected: ["caught"] },
  { name: "order", expected: ["caught:KR"] },
  { name: "inherited", expected: ["caught:old:false"] },
  { name: "forward", expected: ["caught:old"] },
  { name: "effects", expected: ["caught:new:1"] },
  { name: "guards", expected: ["caught:1", "returned:1"] },
  { name: "setter", expected: ["new"] },
  { name: "truthy", expected: ["returned"] },
  { name: "zero", expected: ["caught"] },
  { name: "number", expected: ["caught", "returned"] },
  { name: "correlated-branch", expected: ["false:caught", "true:returned"] },
])("preserves strict property writes: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`strict-writes-${name}.tsx`, expected),
);
