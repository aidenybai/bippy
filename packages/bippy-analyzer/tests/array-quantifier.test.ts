import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "array-quantifier-order.tsx", expected: ["true:1|false:1"] },
  {
    name: "array-quantifier-guards.tsx",
    expected: ["first:true:1:false:2", "later:true:2:false:1"],
  },
  { name: "array-quantifier-shrink.tsx", expected: ["false:1|true:1"] },
  { name: "array-quantifier-conditional-shrink.tsx", expected: ["full:false:3", "short:false:1"] },
  { name: "array-quantifier-throws.tsx", expected: ["someevery:1:1"] },
  { name: "array-quantifier-receiver.tsx", expected: ["true:false:4"] },
  {
    name: "array-quantifier-independent-presence.tsx",
    expected: ["first:none:1", "first:second:2", "none:none:1", "none:second:1"],
  },
  { name: "array-quantifier-length.tsx", expected: ["false:2:3|true:2:3"] },
  { name: "array-finite-spread.tsx", expected: ["1|2|3", "4"] },
  { name: "array-guarded-mutation.tsx", expected: ["same|1|2|3", "same|1|9|3"] },
])("preserves guarded array traversal for $name", ({ name, expected }) =>
  checkConcreteComponentStates(name, expected),
);
