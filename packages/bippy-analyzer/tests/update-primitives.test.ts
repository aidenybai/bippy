import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "string", expected: ["number:1:2"] },
  { name: "values", expected: ["number:0:1|number:1:2|number:0:1|number:0:1|number:NaN:NaN"] },
  { name: "nonfinite", expected: ["true:1|true:true|Infinity:Infinity"] },
  { name: "guards", expected: ["first:number:1:2", "later:number:4:5"] },
  { name: "bigint", expected: ["first:bigint:1:bigint:1:1", "later:bigint:4:bigint:4:4"] },
  { name: "setter", expected: ["caught:string:1:none", "returned:number:2:1"] },
])("updates the $name primitive", ({ name, expected }) =>
  checkConcreteComponentStates(`update-primitive-${name}.tsx`, expected),
);
