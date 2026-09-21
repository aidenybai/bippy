import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "string spreads contribute indexed own properties",
    body: `const target = { ..."ab" }; return Object.keys(target).join(",") + ":" + Object.values(target).join(",");`,
  },
  {
    name: "getters delete later keys without visiting newly added keys",
    body: `const target = { get alpha() { if (first) delete target.beta; if (second) target.gamma = 3; return 1; }, beta: 2 };
      const values = Object.values(target).join(","); return values + ":" + Object.keys(target).join(",");`,
  },
  {
    name: "conditional optional keys preserve their position around common keys",
    body: `const target = {}; if (first) { target.alpha = 1; target.beta = 2; } else { target.gamma = 3; target.alpha = 1; }
      return Object.getOwnPropertyNames(target).join(",");`,
  },
  {
    name: "canonical array-index bounds govern ordinary property order",
    body: `const target = { "4294967295": 1, "01": 2, "1": 3, "-0": 4, "0": 5, "4294967294": 6 };
      return Object.keys(target).join(",");`,
  },
  {
    name: "deleting and reinserting an existing key moves its position",
    body: `const target = { alpha: 0 }; if (first) { delete target.alpha; target.beta = 2; target.alpha = 1; }
      else { delete target.alpha; target.beta = 3; target.alpha = 4; } return Object.keys(target).join(",");`,
  },
  {
    name: "enumerability selects keys without changing own names",
    body: `const target = { alpha: 1 }; Object.defineProperty(target, "beta", { value: 2, enumerable: first });
      return Object.keys(target).join(",") + ":" + Object.getOwnPropertyNames(target).join(",");`,
  },
  {
    name: "conditional presence selects enumeration entries",
    body: `const target = {}; if (first) Object.defineProperty(target, "alpha", { value: 1 }); else target.beta = 2;
      return Object.keys(target).join(",") + ":" + Object.getOwnPropertyNames(target).join(",");`,
  },
  {
    name: "values recheck later descriptors after a getter",
    body: `const trace = []; const target = { get alpha() { trace.push("alpha"); if (first) Object.defineProperty(target, "beta", { enumerable: false }); return 1; }, get beta() { trace.push("beta"); if (second) throw "stop"; return 2; } };
      let outcome; try { outcome = Object.values(target).join(","); } catch (error) { outcome = error; }
      return outcome + ":" + trace.join(",");`,
  },
  {
    name: "entries retain the original getter receiver",
    body: `const target = { get value() { return this === target ? "same" : "different"; } }; if (first) Object.freeze(target);
      return Object.entries(target).map((entry) => entry.join("=")).join(",");`,
  },
  {
    name: "keys and names do not execute accessors",
    body: `let calls = 0; const target = { get value() { calls++; return 7; } };
      return Object.keys(target).join(",") + ":" + Object.getOwnPropertyNames(target).join(",") + ":" + calls;`,
  },
  {
    name: "symbols remain separate from enumerable string keys",
    body: `const token = Symbol("marker"); const target = { plain: 1 }; Object.defineProperty(target, token, { value: 2, enumerable: first });
      const symbols = Object.getOwnPropertySymbols(target); return Object.keys(target).join(",") + ":" + symbols.length + ":" + (symbols[0] === token);`,
  },
  {
    name: "integer keys precede strings and symbols",
    body: `const token = Symbol("marker"); const target = { [token]: 1, plain: 2, "10": 3, "2": 4 };
      return Reflect.ownKeys(target).map((key) => typeof key === "symbol" ? "symbol" : key).join(",");`,
  },
  {
    name: "conditional insertion order stays associated with its input",
    body: `const target = {}; if (first) { target.alpha = 1; target.beta = 2; } else { target.beta = 2; target.alpha = 1; }
      return Object.keys(target).join(",");`,
  },
])("preserves property enumeration: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});
