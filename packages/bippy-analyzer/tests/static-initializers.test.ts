import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "field", expected: ["caught:F"] },
  { name: "block", expected: ["caught:B"] },
  { name: "capture", expected: ["caught:missing", "returned:ready"] },
  {
    name: "guarded-field",
    expected: ["caught:F:false:false:function", "returned:FL:true:true:function"],
  },
  { name: "computed-replacement", expected: ["caught:function:K"] },
  { name: "payloads", expected: ["null", "undefined"] },
  { name: "arguments", expected: ["caught:F"] },
  { name: "order", expected: ["FBM:ready"] },
  { name: "finalizer", expected: ["null:BF"] },
  { name: "handled", expected: ["ready:CB"] },
])("preserves static initialization completion: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`static-initializers-${name}.tsx`, expected),
);
