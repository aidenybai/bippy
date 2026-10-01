import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "getter", expected: ["caught:0", "ready:1"] },
  { name: "delete", expected: ["caught"] },
  { name: "proxy", expected: ["caught:1"] },
  { name: "getter-receivers", expected: ["first:first", "second:second"] },
  { name: "delete-branches", expected: ["caught:K", "returned:K"] },
  { name: "delete-optional", expected: ["true:"] },
  { name: "delete-receiver", expected: ["object:B"] },
  { name: "proxy-getter", expected: ["trap:RG"] },
  { name: "proxy-receiver", expected: ["handler"] },
  { name: "proxy-guards", expected: ["caught:old:1", "returned:new:1"] },
  { name: "proxy-identity", expected: ["true:1"] },
])("preserves property effects: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`property-effects-${name}.tsx`, expected),
);
