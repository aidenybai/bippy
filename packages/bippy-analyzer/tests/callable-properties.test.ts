import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "class", expected: ["missing:false:false", "ready:true:true"] },
  { name: "function", expected: ["missing:false:false", "ready:true:true"] },
  { name: "existing", expected: ["new:true", "old:true"] },
  { name: "undefined", expected: ["undefined:false", "undefined:true"] },
  { name: "inheritance", expected: ["base:false", "own:true"] },
  { name: "shadow", expected: ["base:false", "undefined:true"] },
  { name: "delete", expected: ["base:false", "own:true"] },
  { name: "plain", expected: ["first:second:true:true"] },
  { name: "class-control", expected: ["ready:true:true"] },
  { name: "bound-control", expected: ["ready:undefined:false:called"] },
  { name: "prototype-control", expected: ["object:true"] },
  { name: "prototype", expected: ["missing:false", "ready:true"] },
  { name: "method", expected: ["missing:false", "ready:true"] },
  {
    name: "prototype-kinds",
    expected: [
      "true:false:true|object:true|undefined:false|undefined:false|undefined:false|undefined:false|object:true|undefined:false|undefined:false",
    ],
  },
])("preserves callable property state: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`callable-properties-${name}.tsx`, expected),
);
