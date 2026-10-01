import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "delete", expected: ["caught:K:true", "returned:K:false"] },
  { name: "own", expected: ["false:false:undefined", "true:true:undefined"] },
  { name: "add", expected: ["false:false:undefined", "true:true:new"] },
  { name: "repeat", expected: ["false:undefined", "true:new", "true:old"] },
  { name: "prototype", expected: ["true:false:parent", "true:true:undefined"] },
  { name: "spread", expected: ["true:old", "true:undefined"] },
  { name: "snapshot", expected: ["false:undefined", "true:first"] },
  { name: "delete-twice", expected: ["false:undefined", "true:old"] },
  { name: "accessor", expected: ["new:1:1"] },
])("preserves property presence: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`property-presence-${name}.tsx`, expected),
);
