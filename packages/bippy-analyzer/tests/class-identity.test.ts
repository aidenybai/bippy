import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "allocation", expected: ["false:2"] },
  { name: "extraction", expected: ["unbound"] },
  { name: "receivers", expected: ["unbound:unbound:other:instance:class"] },
  { name: "methods", expected: ["true:false:true"] },
  { name: "fields", expected: ["1:2:false:true:false"] },
  { name: "guards", expected: ["false:2", "true:1"] },
  { name: "duplicate-super", expected: ["true:false:false:2:true"] },
  { name: "react", expected: ["mount", "ready"] },
])("preserves class identity: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`class-identity-${name}.tsx`, expected),
);
