import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "accessor", expected: ["proxy"] },
  { name: "identity", expected: ["proxy"] },
  { name: "nested", expected: ["outer:handler:new"] },
  { name: "guards", expected: ["caught:A:proxy", "returned:B:proxy"] },
  { name: "null", expected: ["proxy:new"] },
  { name: "bound", expected: ["bound:new"] },
  { name: "ordinary", expected: ["child:new"] },
  { name: "throw", expected: ["caught:proxy:1"] },
])("preserves proxy setter receivers: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`proxy-receivers-${name}.tsx`, expected),
);
