import { it } from "vite-plus/test";
import { checkGuardedCases, checkSymbolicCases } from "./helpers/differential-evaluator.js";

it.each([
  {
    name: "conditional descriptors retain non-enumerable own names",
    body: `const target = {}; Object.defineProperty(target, "value", { value: 1, configurable: true });
      if (first) Object.defineProperty(target, "value", { get: () => 2, configurable: true });
      return Object.getOwnPropertyNames(target).join(",") + ":" + Object.keys(target).length;`,
  },
  {
    name: "later definitions resolve earlier unknown enumeration flags",
    body: `const target = {}; Object.defineProperty(target, "value", { value: 1, configurable: true, enumerable: first });
      Object.defineProperty(target, "value", { enumerable: true }); return Object.keys(target).join(",");`,
  },
  {
    name: "conditional data-to-accessor conversion retains getter effects",
    body: `let calls = 0; const target = { value: 1 };
      if (first) Object.defineProperty(target, "value", { get() { calls++; return 2; }, configurable: true });
      return target.value + ":" + calls;`,
  },
  {
    name: "conditional data-to-accessor conversion retains setter effects",
    body: `let stored = 0; const target = { value: 1 };
      if (first) Object.defineProperty(target, "value", { get: () => stored, set(value) { stored = value * 2; }, configurable: true });
      target.value = second ? 3 : 5; return target.value + ":" + stored;`,
  },
  {
    name: "conditionally present data retains attributes after writes",
    body: `const target = {};
      if (first) Object.defineProperty(target, "value", { value: 1, writable: true });
      target.value = 9; const descriptor = Object.getOwnPropertyDescriptor(target, "value");
      return descriptor.value + ":" + descriptor.enumerable + ":" + descriptor.configurable;`,
  },
  {
    name: "descriptor conversion preserves writes before a conditional throw",
    body: `let calls = 0; const target = {}; let outcome = "ok";
      const descriptor = { get enumerable() { calls++; if (first) throw "stop"; return true; }, get value() { calls += 2; return 7; } };
      try { Object.defineProperty(target, "value", descriptor); } catch (error) { outcome = error; }
      return outcome + ":" + calls + ":" + typeof target.value;`,
  },
  {
    name: "proxy has throws stop descriptor conversion on that path",
    body: `let calls = 0; const target = {}; let outcome = "ok";
      const descriptor = new Proxy({ value: 7 }, { has(target, key) { calls++; if (first) throw "stop"; return key in target; } });
      try { Object.defineProperty(target, "value", descriptor); } catch (error) { outcome = error; }
      return outcome + ":" + calls + ":" + typeof target.value;`,
  },
  {
    name: "rejected proxy definitions retain trap writes",
    body: `const target = {}; let outcome = "ok";
      const proxy = new Proxy(target, { defineProperty(target, key, descriptor) { Object.defineProperty(target, key, descriptor); return !first; } });
      try { Object.defineProperty(proxy, "value", { value: 7, configurable: true }); } catch (error) { outcome = error.name; }
      return outcome + ":" + target.value;`,
  },
  {
    name: "proxy has cannot hide a non-configurable property",
    body: `let calls = 0; const target = {}; Object.defineProperty(target, "value", { value: 7 });
      const proxy = new Proxy(target, { has() { calls++; return !first; } });
      let outcome; try { outcome = "value" in proxy; } catch (error) { outcome = error.name; }
      return outcome + ":" + calls;`,
  },
  {
    name: "proxy definitions cannot claim a new non-configurable property",
    body: `const target = {}; const proxy = new Proxy(target, { defineProperty() { return true; } });
      let outcome = "ok"; try { Object.defineProperty(proxy, "value", { value: 7, configurable: first }); } catch (error) { outcome = error.name; }
      return outcome + ":" + Object.hasOwn(target, "value");`,
  },
  {
    name: "narrowing does not remove readonly metadata",
    body: `const target = {}; Object.defineProperty(target, "value", { value: first, configurable: true });
      let outcome = "ok"; if (target.value) { try { target.value = false; } catch (error) { outcome = error.name; } }
      return outcome + ":" + (target.value ? "truthy" : "falsy");`,
  },
  {
    name: "non-configurable properties reject only the redefining path",
    body: `const target = {}; Object.defineProperty(target, "value", { value: 1, configurable: true });
      if (first) Object.defineProperty(target, "value", { configurable: false });
      let outcome = "ok";
      try { Object.defineProperty(target, "value", { value: 2 }); } catch (error) { outcome = error.name; }
      return outcome + ":" + target.value;`,
  },
  {
    name: "conditional writable metadata controls aliased writes",
    body: `const target = { value: 1 }; const alias = target;
      if (first) Object.defineProperty(target, "value", { writable: false });
      let outcome = "ok"; try { alias.value = 2; } catch (error) { outcome = error.name; }
      return outcome + ":" + target.value;`,
  },
  {
    name: "successful writes preserve descriptor attributes",
    body: `const target = {}; Object.defineProperty(target, "value", { value: 1, writable: true });
      target.value = 2; const descriptor = Object.getOwnPropertyDescriptor(target, "value");
      return descriptor.value + ":" + descriptor.enumerable + ":" + descriptor.configurable + ":" + descriptor.writable;`,
  },
  {
    name: "conditional configurable metadata controls deletion",
    body: `const target = { value: 1 };
      if (first) Object.defineProperty(target, "value", { configurable: false });
      let outcome = "ok"; try { delete target.value; } catch (error) { outcome = error.name; }
      return outcome + ":" + String(target.value);`,
  },
  {
    name: "partial accessor descriptors retain the existing setter",
    body: `const target = { count: 0 };
      Object.defineProperty(target, "value", { get() { return this.count; }, set(value) { this.count = value; }, configurable: true });
      if (first) Object.defineProperty(target, "value", { get() { return this.count * 2; } });
      target.value = second ? 3 : 5; return target.value + ":" + target.count;`,
  },
  {
    name: "readonly inherited properties reject writes through a child",
    body: `const prototype = {}; Object.defineProperty(prototype, "value", { value: 1 });
      const target = Object.create(prototype); let outcome = "ok";
      try { target.value = 2; } catch (error) { outcome = error.name; }
      return outcome + ":" + target.value + ":" + Object.hasOwn(target, "value");`,
  },
  {
    name: "absent and readonly properties retain distinct permissions",
    body: `const target = {};
      if (first) Object.defineProperty(target, "value", { value: 1 });
      let outcome = "ok"; try { target.value = 9; } catch (error) { outcome = error.name; }
      return outcome + ":" + target.value;`,
  },
  {
    name: "conditional getters retain their selecting input",
    body: `const target = {};
      Object.defineProperty(target, "value", { get: () => 1, configurable: true });
      if (first) Object.defineProperty(target, "value", { get: () => 2, configurable: true });
      return String(target.value);`,
  },
  {
    name: "conditional getters mutate through the original receiver",
    body: `const target = { count: 0 }; const alias = target;
      Object.defineProperty(target, "value", { get() { this.count++; return "original"; }, configurable: true });
      if (first) Object.defineProperty(target, "value", { get() { this.count += 2; return "replacement"; }, configurable: true });
      return alias.value + ":" + target.count;`,
  },
  {
    name: "conditional setters retain their receiver and input",
    body: `const target = { count: 0 }; const alias = target;
      Object.defineProperty(target, "value", { set(value) { this.count += value; }, configurable: true });
      if (first) Object.defineProperty(target, "value", { set(value) { this.count += value * 2; }, configurable: true });
      alias.value = second ? 3 : 5; return String(target.count);`,
  },
  {
    name: "nested getter replacement is visible to the outer fork",
    body: `const target = {};
      Object.defineProperty(target, "value", { get: () => 1, configurable: true });
      if (first) {
        if (second) Object.defineProperty(target, "value", { get: () => 2, configurable: true });
        else Object.defineProperty(target, "value", { get: () => 3, configurable: true });
      }
      return String(target.value);`,
  },
  {
    name: "descriptor inspection does not invoke a conditional getter",
    body: `let calls = 0; const target = {}; const left = () => { calls++; return 1; };
      const right = () => { calls++; return 2; };
      Object.defineProperty(target, "value", { get: left, configurable: true });
      if (first) Object.defineProperty(target, "value", { get: right, configurable: true });
      const descriptor = Object.getOwnPropertyDescriptor(target, "value");
      return (descriptor.get === left) + ":" + calls;`,
  },
])("preserves mutation metadata: $name", async (testCase) => {
  await checkGuardedCases([testCase]);
  await checkSymbolicCases([testCase]);
});
