import { expect, it } from "vite-plus/test";
import { getTruthinessPredicate } from "../src/evaluate/predicates.js";
import { branchValue, primitiveValue, unknownPrimitiveValue } from "../src/evaluate/values.js";
import { parseSymbolicPredicate } from "../src/symbolic/serialization.js";
import { checkGuardedCases, getGuardedOutcomes } from "./helpers/differential-evaluator.js";

it("distinguishes swapped outcomes even when their sets agree", () => {
  const input = unknownPrimitiveValue("boolean", "input");
  const predicate = getTruthinessPredicate(input);
  const guard = parseSymbolicPredicate(predicate).formula;
  if (!guard) throw new Error("Expected input guard");
  const correct = branchValue([primitiveValue(1), primitiveValue(2)], "input", null, 0, predicate);
  const swapped = branchValue([primitiveValue(2), primitiveValue(1)], "input", null, 0, predicate);
  expect(getGuardedOutcomes(correct, guard)).toEqual([{ kind: "return", value: 1 }]);
  expect(getGuardedOutcomes(swapped, guard)).toEqual([{ kind: "return", value: 2 }]);
});

it.each([
  {
    name: "repeated input reads",
    body: `return (first ? "a" : "b") + (first ? "a" : "b");`,
  },
  {
    name: "independent inputs",
    body: `return (first ? "a" : "b") + (second ? "c" : "d");`,
  },
  {
    name: "correlated arithmetic",
    body: `const left = first ? 1 : 2; const right = first ? 10 : 20; return left + right;`,
  },
  {
    name: "string replacement alternatives isolate callback writes",
    body: `let calls = 0; const search = first ? "a" : "b";
      const value = "a".replace(search, () => { calls++; return "x"; });
      return value + ":" + calls;`,
  },
  {
    name: "string replacement alternatives retain callback throws",
    body: `const state = { calls: 0 }; const search = first ? "a" : "b";
      try { const value = "a".replace(search, () => { state.calls++; throw "replace"; });
        return value + ":" + state.calls; }
      catch (error) { return error + ":" + state.calls; }`,
  },
  {
    name: "replacement throws stop later matches on their path",
    body: `let calls = 0;
      try { const value = "aba".replaceAll("a", () => {
        calls++; if (first) throw "replace"; return second ? "x" : "y";
      }); return value + ":" + calls; }
      catch (error) { return error + ":" + calls; }`,
  },
  {
    name: "replacement callbacks receive groups and offsets",
    body: `return "a ab".replace(/(?<left>a)(b)?/g,
      (match, left, right, offset, input, groups) =>
        groups.left + ":" + String(right) + ":" + offset + ":" + input.length);`,
  },
  {
    name: "nullish lexical write",
    body: `let calls = 0; const fallback = () => { calls += 1; return "fallback"; };
      const input = first ? null : 0; const value = input ?? fallback();
      return String(value) + ":" + calls;`,
  },
  {
    name: "nullish alias and closure write",
    body: `const state = { count: 0 }; const alias = state; const read = () => alias.count;
      const input = first ? undefined : false;
      const value = input ?? (() => { state.count++; return "fallback"; })();
      return String(value) + ":" + read();`,
  },
  {
    name: "nested nullish forks",
    body: `let calls = 0; const input = first ? null : 0;
      const value = input ?? (second ? (++calls, "a") : (++calls, "b"));
      return String(value) + ":" + calls;`,
  },
  {
    name: "nullish getter runs only on fallback",
    body: `let calls = 0; const state = { get fallback() { calls++; return "fallback"; } };
      const value = (first ? null : "") ?? state.fallback;
      return value + ":" + calls;`,
  },
  {
    name: "nullish left is evaluated once",
    body: `let calls = 0; const read = () => { calls++; return first ? null : 0; };
      const value = read() ?? 4; return String(value) + ":" + calls;`,
  },
  {
    name: "nullish throwing left skips right",
    body: `let calls = 0; const left = () => { if (first) throw "left"; return null; };
      try { const value = left() ?? (++calls, "right"); return value + ":" + calls; }
      catch (error) { return error + ":" + calls; }`,
  },
  {
    name: "conditional thrown result",
    body: `const fallback = () => { throw "fallback"; }; return (first ? null : 0) ?? fallback();`,
  },
  {
    name: "early return excludes later writes",
    body: `const state = { count: 0 };
      const run = () => { if (first) { state.count = 1; return "early"; } state.count = 2; return "late"; };
      const value = run(); return value + ":" + state.count;`,
  },
  {
    name: "closure activations keep distinct bindings",
    body: `const create = (value) => () => ++value;
      const left = create(0); const right = create(10);
      if (first) left(); else right(); return left() + ":" + right();`,
  },
  {
    name: "finally overrides only its selected path",
    body: `const run = () => { try { if (first) throw "throw"; return "return"; }
      finally { if (second) return "finally"; } };
      try { return run(); } catch (error) { return error; }`,
  },
  {
    name: "if test completion skips both arms on a throw",
    body: `let calls = 0; const test = () => { if (first) throw "test"; return second; };
      try { if (test()) calls += 1; else calls += 2; return "normal:" + calls; }
      catch (error) { return error + ":" + calls; }`,
  },
  {
    name: "void preserves conditional throws",
    body: `const run = () => { if (first) throw "throw"; return 1; };
      try { return String(void run()); } catch (error) { return error; }`,
  },
  {
    name: "throw expression preserves an earlier throw payload",
    body: `const run = () => { if (first) throw "inner"; return "outer"; };
      try { throw run(); } catch (error) { return error; }`,
  },
  {
    name: "iterator advancement stays attached to its input",
    body: `const iterator = new Set([10, 20, 30]).values();
      if (first) iterator.next(); return iterator.next().value;`,
  },
  {
    name: "mapped rows share the outer selection",
    body: `const selected = first ? 1 : 2;
      return [1, 2].map((value) => value === selected ? "selected" : "idle").join(":");`,
  },
])("preserves input-associated outcomes: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
});

it.each([
  {
    name: "a suspended path does not delay an independent return",
    body: `let log = ""; let settle;
      const pending = new Promise((resolve) => { settle = resolve; });
      const run = async () => {
        if (first) { log += "wait:"; await pending; log += "resume:"; }
        else { log += "fast:"; return "fast"; }
        return "done";
      };
      run().then((value) => { log += value; }); log += "sync:";
      queueMicrotask(() => settle()); return () => log;`,
  },
  {
    name: "a suspended branch resumes the enclosing continuation",
    body: `let log = ""; const run = async () => {
      if (first) { await Promise.resolve(); log += "await:"; }
      log += "after:"; return second ? "left" : "right";
    }; run().then((value) => { log += value; }); log += "sync:"; return () => log;`,
  },
  {
    name: "a mixed suspended try finalizes its synchronous path immediately",
    body: `let log = ""; const run = async () => {
      try { if (first) await Promise.resolve(); return "done"; }
      finally { log += "cleanup:"; }
    }; run().then((value) => { log += value; }); log += "sync:"; return () => log;`,
  },
  {
    name: "catch suspension retains the pending finalizer",
    body: `let log = ""; const run = async () => {
      try { throw "error"; } catch (error) { await Promise.resolve(); log += error; }
      finally { log += ":finally"; } log += ":after";
    }; run(); log += "sync:"; return () => log;`,
  },
  {
    name: "conditional promise reaction registration",
    body: `let log = ""; let resolve; const pending = new Promise((finish) => { resolve = finish; });
      if (first) pending.then(() => { log += "a"; });
      resolve(); return () => log;`,
  },
  {
    name: "conditional microtask registration",
    body: `let log = ""; if (first) queueMicrotask(() => { log += "a"; });
      queueMicrotask(() => { log += "b"; }); return () => log;`,
  },
  {
    name: "microtasks preserve each path's queue order",
    body: `let log = ""; const left = () => { log += "a"; }; const right = () => { log += "b"; };
      if (first) { queueMicrotask(left); queueMicrotask(right); }
      else { queueMicrotask(right); queueMicrotask(left); }
      return () => log;`,
  },
])("preserves task registration: $name", async (testCase) => {
  await checkGuardedCases([testCase], true);
});
