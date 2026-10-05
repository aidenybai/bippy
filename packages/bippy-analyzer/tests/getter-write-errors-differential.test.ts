import { it } from "vite-plus/test";
import { checkDifferentialCases } from "./helpers/differential-evaluator.js";

it.each(["length", "value", "space key", "0"])(
  "matches native getter-only write errors for %s",
  (key) =>
    checkDifferentialCases(
      ["{}", "Object.fromEntries([])"].map((expression) => ({
        name: `${expression}/${key}`,
        body: `const target = ${expression}; Object.defineProperty(target, ${JSON.stringify(key)}, { get() { return 1; } }); try { target[${JSON.stringify(key)}] = 2; return 'accepted'; } catch (error) { return error.name + ':' + error.message; }`,
      })),
    ),
);
