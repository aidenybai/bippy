import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "freezing a container leaves its backing store mutable",
    body: `const store = {}; Object.defineProperty(store, "validated", { value: 0, writable: true });
      const element = { store }; if (first) Object.freeze(element); else Object.seal(element);
      store.validated = 7; return element.store.validated + ":" + Object.isFrozen(store) + ":" + Object.getOwnPropertyDescriptor(element, "store").writable;`,
  },
  {
    name: "freeze, seal and extensibility remain correlated with writes",
    body: `const target = { value: 0 }; let writes = "";
      if (first) Object.freeze(target); else if (second) Object.seal(target);
      try { target.value = 7; writes += "value"; } catch (error) { writes += error.name; }
      try { target.extra = 8; writes += ":extra"; } catch (error) { writes += ":" + error.name; }
      return writes + ":" + target.value + ":" + String(target.extra) + ":" + Object.isFrozen(target) + ":" + Object.isSealed(target) + ":" + Object.isExtensible(target);`,
  },
  {
    name: "freezing a selected alias does not freeze its sibling",
    body: `const left = { value: 0 }; const right = { value: 0 };
      const selected = first ? left : right; Object.freeze(selected);
      return Object.isFrozen(left) + ":" + Object.isFrozen(right);`,
  },
  {
    name: "nested integrity mutations reach the outer journal",
    body: `const target = { value: 0 };
      if (first) { if (second) Object.freeze(target); else Object.preventExtensions(target); }
      let outcome = "ok"; try { target.value = 3; target.extra = 7; } catch (error) { outcome = error.name; }
      return outcome + ":" + target.value + ":" + String(target.extra) + ":" + Object.isExtensible(target);`,
  },
  {
    name: "readonly transitions change derived frozen status",
    body: `const target = { value: 7 }; Object.preventExtensions(target);
      if (first) Object.defineProperty(target, "value", { configurable: false });
      if (second) Object.defineProperty(target, "value", { writable: false });
      return Object.isFrozen(target) + ":" + Object.isSealed(target);`,
  },
  {
    name: "integrity survives writes before an application throw",
    body: `const target = { value: 0 }; let outcome = "ok";
      try { if (first) { Object.freeze(target); throw "stop"; } } catch (error) { outcome = error; }
      try { target.value = 7; } catch (error) { outcome += ":" + error.name; }
      return outcome + ":" + target.value;`,
  },
  {
    name: "sealed accessors still call their setter",
    body: `let stored = 0; const target = { get value() { return stored; }, set value(value) { stored = value; } };
      if (first) Object.freeze(target); else if (second) Object.seal(target);
      target.value = 7; return target.value + ":" + Object.isFrozen(target);`,
  },
  {
    name: "freezing a prototype protects inherited data but not absent keys",
    body: `const prototype = { value: 0 }; const target = Object.create(prototype);
      if (first) Object.freeze(prototype); let outcome = "ok";
      try { target.value = 7; } catch (error) { outcome = error.name; }
      target.extra = 3; return outcome + ":" + target.value + ":" + target.extra;`,
  },
  {
    name: "proxy has cannot hide an own property on a non-extensible target",
    body: `const target = { value: 7 }; if (first) Object.preventExtensions(target);
      const proxy = new Proxy(target, { has() { return false; } });
      try { return String("value" in proxy); } catch (error) { return error.name; }`,
  },
])("preserves integrity metadata: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});

it("preserves conditional microtask integrity changes", async () => {
  const testCase = {
    name: "microtask freeze",
    body: `const target = { value: 0 }; if (first) queueMicrotask(() => Object.freeze(target));
      return () => { let outcome = "ok"; try { target.value = 7; } catch (error) { outcome = error.name; }
        return outcome + ":" + target.value + ":" + Object.isFrozen(target); };`,
  };
  await checkGuardedCases([testCase], true);
  await checkSymbolicCases([testCase], true);
});
