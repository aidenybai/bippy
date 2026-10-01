import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "a thrown getter prevents later initializers",
    body: `const trace = []; const source = { get value() { trace.push("get"); if (first) throw "stop"; return 7; } };
      let outcome; try { const result = { ...source, tail: trace.push("tail") }; outcome = result.value; } catch (error) { outcome = error; }
      return outcome + ":" + trace.join(",");`,
  },
  {
    name: "copying rechecks deleted keys without visiting new ones",
    body: `const source = { get alpha() { if (first) delete source.beta; if (second) source.gamma = 3; return 1; }, beta: 2 };
      const result = { ...source }; return Object.keys(result).join(",") + ":" + String(result.beta) + ":" + String(result.gamma);`,
  },
  {
    name: "enumerable symbols are copied as writable data",
    body: `const token = Symbol("marker"); const source = {}; Object.defineProperty(source, token, { value: 7, enumerable: first });
      const result = { ...source }; if (first) result[token] = 9;
      return Object.getOwnPropertySymbols(result).length + ":" + String(result[token]);`,
  },
  {
    name: "frozen accessors use their receiver and become writable data",
    body: `const source = { get value() { return this === source ? 7 : 0; } }; if (first) Object.freeze(source);
      const result = { ...source }; const initial = result.value; result.value = 9;
      return initial + ":" + result.value + ":" + Object.getOwnPropertyDescriptor(result, "value").writable;`,
  },
  {
    name: "copied values retain nested object aliases",
    body: `const payload = { count: 0 }; const source = { get value() { return payload; } }; const result = { ...source };
      payload.count = first ? 7 : 9; return (result.value === payload) + ":" + result.value.count;`,
  },
  {
    name: "copying a conditional source preserves key order",
    body: `const source = first ? { alpha: 1, beta: 2 } : { beta: 2, alpha: 1 }; const result = { ...source };
      return Object.keys(result).join(",");`,
  },
])("executes object spread: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});
