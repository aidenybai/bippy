import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "replacement", expected: ["new"] },
  { name: "this-before-super", expected: ["caught:0"] },
  { name: "fields", expected: ["new-body:new-field"] },
  { name: "arrow", expected: ["caught:true:new"] },
  { name: "guards", expected: ["first:first-field", "second:second-field"] },
  { name: "function", expected: ["other:new"] },
  { name: "super-method", expected: ["new"] },
  { name: "super-key", expected: ["caught:0:0"] },
  { name: "optional-key", expected: ["new:1", "none:0"] },
  { name: "key-throw", expected: ["caught:1:0", "new:1:1"] },
  { name: "super-getters", expected: ["new:KG"] },
])("preserves derived this: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`derived-this-${name}.tsx`, expected),
);
