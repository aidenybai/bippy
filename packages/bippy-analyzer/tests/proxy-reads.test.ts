import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "receiver", expected: ["handler"] },
  { name: "accessor", expected: ["GT"] },
  { name: "forwarding", expected: ["proxy"] },
  { name: "nested", expected: ["handler:outer"] },
  { name: "guards", expected: ["caught:KG", "returned:KGTAC"] },
  { name: "null", expected: ["ready"] },
  { name: "bound", expected: ["bound"] },
  { name: "ordinary", expected: ["child"] },
])("preserves proxy reads: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`proxy-reads-${name}.tsx`, expected),
);
