import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "array-map-closure.tsx", expected: ["1:0", "2:0,2:1"] },
  { name: "array-reduce-closure.tsx", expected: ["1:0", "2:0,2:1"] },
  { name: "array-context-prefix.tsx", expected: ["", "root,child"] },
  { name: "array-generated-prefix.tsx", expected: ["", "root", "root,child"] },
  { name: "array-nested-prefix.tsx", expected: ["", "root,child"] },
  { name: "array-concat-closure.tsx", expected: ["root,child,root,child", "root,root"] },
  { name: "array-call-arguments.tsx", expected: ["1:root,child,root,child", "1:root,root"] },
  { name: "array-optional-arguments.tsx", expected: ["0:none", "1:root,root"] },
])("keeps the selected receiver and closure reads together in $name", ({ name, expected }) =>
  checkConcreteComponentStates(name, expected, ","),
);
