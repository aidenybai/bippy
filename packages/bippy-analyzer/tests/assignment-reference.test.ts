import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "scalar", expected: ["caught:old", "returned:new"] },
  { name: "member", expected: ["caught:LR:old", "returned:LR:new"] },
  { name: "computed", expected: ["caught:K:old", "returned:KR:new"] },
  { name: "phases", expected: ["BKRS:2|BKGRS:4|BKGS:4:5|BKGS:4:4"] },
  { name: "reassigned", expected: ["new:old:true|new:old:second"] },
  { name: "setter-throw", expected: ["caught:old:1", "returned:new:1"] },
  { name: "compound-throw", expected: ["caught:BKGR:old", "returned:BKGRS:oldnew"] },
  { name: "logical", expected: ["kept:BKG:old", "set:BKGRS:new"] },
  { name: "receiver-throw", expected: ["caught:B:old", "returned:BKR:new"] },
  { name: "nested", expected: ["1:3"] },
  { name: "guards", expected: ["0:0:0:2", "2:0:0:0"] },
])("preserves the $name assignment reference", ({ name, expected }) =>
  checkConcreteComponentStates(`assignment-reference-${name}.tsx`, expected),
);
