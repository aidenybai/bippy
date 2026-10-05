import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "getters and setters interleave before the next descriptor check",
    body: `const trace = []; const source = { get alpha() { trace.push("get-alpha"); return 1; }, get beta() { trace.push("get-beta"); if (second) throw "stop"; return 2; } };
      const target = { set alpha(value) { trace.push("set-alpha"); if (first) delete source.beta; }, set beta(value) { trace.push("set-beta"); } };
      try { Object.assign(target, source); trace.push("done"); } catch (error) { trace.push(error); } return trace.join(",");`,
  },
  {
    name: "readonly rejection retains getter effects and skips later reads",
    body: `const trace = []; const target = { alpha: 0 }; if (first) Object.freeze(target);
      const source = { get alpha() { trace.push("alpha"); return 7; }, get beta() { trace.push("beta"); if (second) throw "stop"; return 9; } };
      try { Object.assign(target, source); trace.push("done"); } catch (error) { trace.push(typeof error === "string" ? error : error.name); }
      return trace.join(",") + ":" + target.alpha + ":" + String(target.beta);`,
  },
  {
    name: "symbol traps receive the original symbol and receiver",
    body: `const token = Symbol("marker"); const trace = []; const backing = {}; const source = {};
      Object.defineProperty(source, token, { enumerable: first, get() { trace.push("get-source"); return second ? 7 : 9; } });
      const proxy = new Proxy(backing, { set(target, key, value, receiver) { trace.push((key === token) + ":" + (receiver === proxy)); target[key] = value; return !second; }, get(target, key, receiver) { trace.push("read:" + (key === token)); return target[key]; } });
      try { Object.assign(proxy, source); } catch (error) { trace.push(error.name); }
      const value = proxy[token]; return trace.join(",") + ":" + String(value);`,
  },
  {
    name: "later sources are not read after an earlier throw",
    body: `const trace = []; const target = {}; const early = { get alpha() { trace.push("early"); if (first) throw "stop"; return 1; } };
      const late = { get beta() { trace.push("late"); return second ? 2 : 3; } };
      try { Object.assign(target, early, late); } catch (error) { trace.push(error); }
      return trace.join(",") + ":" + String(target.alpha) + ":" + String(target.beta);`,
  },
  {
    name: "a selected target retains identity and sibling isolation",
    body: `const left = { value: 0 }; const right = { value: 0 }; const selected = first ? left : right;
      const result = Object.assign(selected, { value: second ? 7 : 9 });
      return (result === selected) + ":" + left.value + ":" + right.value;`,
  },
  {
    name: "primitive sources copy UTF-16 indices and skip nullish values",
    body: `const target = {}; if (first) Object.freeze(target); let outcome = "done";
      try { Object.assign(target, null, undefined, "😀"); } catch (error) { outcome = error.name; }
      return outcome + ":" + Object.keys(target).join(",") + ":" + String(target[0]) + String(target[1]);`,
  },
  {
    name: "invalid targets throw before invoking source getters",
    body: `let calls = 0; const source = { get value() { calls++; return 7; } }; let outcome = "done";
      try { Object.assign(first ? null : undefined, source); } catch (error) { outcome = error.name; }
      return outcome + ":" + calls;`,
  },
])("executes object copying: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});
