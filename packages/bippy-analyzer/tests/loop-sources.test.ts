import { it } from "vite-plus/test";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";
it.each([
  {
    name: "for-of",
    expected: ["caught:R"],
  },
  {
    name: "for-in",
    expected: ["caught:R"],
  },
  {
    name: "guarded-of",
    expected: ["no:returned:R12L", "yes:caught:R"],
  },
  {
    name: "guarded-in",
    expected: ["no:returned:RfirstsecondL", "yes:caught:R"],
  },
  {
    name: "target",
    expected: ["caught:R"],
  },
  {
    name: "getter",
    expected: ["caught:R"],
  },
  {
    name: "empty",
    expected: ["returned:RL"],
  },
  {
    name: "nullish-in",
    expected: ["returned:RL"],
  },
  {
    name: "string",
    expected: ["returned:RabL"],
  },
  {
    name: "payloads",
    expected: ["null", "undefined"],
  },
])("preserves loop source completion: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`loop-sources-${name}.tsx`, expected),
);
