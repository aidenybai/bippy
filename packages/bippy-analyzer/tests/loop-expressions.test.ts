import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";
it.each([
  {
    name: "initializer",
    expected: ["caught:I"],
  },
  {
    name: "condition",
    expected: ["caught:T"],
  },
  {
    name: "increment",
    expected: ["caught:BU"],
  },
  {
    name: "initializer-correlation",
    expected: ["no:returned:IBL", "yes:caught:I"],
  },
  {
    name: "test-guards",
    expected: ["caught:T", "returned:TBTL"],
  },
  {
    name: "update-guards",
    expected: ["caught:BU", "returned:BUBUL"],
  },
  {
    name: "declarations",
    expected: ["caught:A", "returned:AIBL"],
  },
  {
    name: "phase-order",
    expected: ["caught:TBU"],
  },
  {
    name: "empty",
    expected: ["returned:ITL"],
  },
  {
    name: "post-test",
    expected: ["caught:BT"],
  },
  {
    name: "pre-test",
    expected: ["caught:T"],
  },
  {
    name: "expression",
    expected: ["caught:I", "returned:IBL"],
  },
  {
    name: "payloads",
    expected: ["null", "undefined"],
  },
  {
    name: "body-update",
    expected: ["body:B", "returned:BUL", "update:BU"],
  },
  {
    name: "continue-update",
    expected: ["update:BU"],
  },
  {
    name: "break-control",
    expected: ["returned:BL"],
  },
  {
    name: "single-iteration",
    expected: ["returned:BTL"],
  },
])("preserves loop expression completion: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`loop-expressions-${name}.tsx`, expected),
);
