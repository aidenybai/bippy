import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "number", expected: ["caught"] },
  { name: "string", expected: ["caught"] },
  { name: "guards", expected: ["caught", "returned"] },
  { name: "props", expected: ["unbound"] },
  { name: "error", expected: ["unbound"] },
  { name: "base", expected: ["returned"] },
  { name: "arrow", expected: ["lexical"] },
  { name: "bound", expected: ["bound"] },
])("preserves class results: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`class-results-${name}.tsx`, expected),
);
