import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "body", expected: ["caught:1"] },
  { name: "field", expected: ["caught:1:0"] },
  { name: "replacement", expected: ["new"] },
  { name: "super", expected: ["caught:1:0", "returned:2:11"] },
  { name: "fields", expected: ["caught:A", "returned:ABC"] },
  { name: "retry", expected: ["1:1", "2:1"] },
  { name: "duplicate-super", expected: ["caught:2"] },
  { name: "react", expected: ["constructor"] },
  { name: "identity", expected: ["true:false:new"] },
  { name: "react-guards", expected: ["constructor", "ready"] },
])("preserves constructor $name completion", ({ name, expected }) =>
  checkConcreteComponentStates(`constructor-completion-${name}.tsx`, expected),
);
