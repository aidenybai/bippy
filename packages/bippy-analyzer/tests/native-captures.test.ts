import { expect, it } from "vite-plus/test";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import {
  registerNativeClosure,
  getNativeCaptures as getSourceCaptures,
} from "../engine/extensions/native-captures.mjs";
import { evaluateLowered } from "./helpers/control-fixture.js";

it("keeps identity, reflection and integrity when attaching or replacing metadata", () => {
  const closure = Object.freeze(() => 1);
  const descriptors = Object.getOwnPropertyDescriptors(closure);
  const prototype = Object.getPrototypeOf(closure);
  const first = { bindings: [], ambientNames: ["first"] };
  const second = { bindings: [], ambientNames: ["second"] };
  expect(registerNativeClosure(closure, () => first)).toBe(closure);
  expect(getSourceCaptures(closure)).toBe(first);
  registerNativeClosure(closure, () => second);
  expect(getSourceCaptures(closure)).toBe(second);
  expect(Object.getOwnPropertyDescriptors(closure)).toEqual(descriptors);
  expect(Object.getPrototypeOf(closure)).toBe(prototype);
  expect(Object.isFrozen(closure)).toBe(true);
  expect(closure()).toBe(1);
});

it("ships capture metadata for maintained engine algorithms", async () => {
  const { api } = await getSymbolicEngine();
  const captures = api.getNativeCaptures(api.ToBoolean);
  expect(captures).toBeDefined();
  expect(captures?.bindings.length).toBeGreaterThan(0);
});

it("uses frame capture metadata for emitters while tracking their escaping closures", async () => {
  expect(
    await evaluateLowered(`
      function* run() {
        let value = 2;
        yield () => value;
        value = 3;
      }
      const iterator = run();
      const callback = iterator.next().value;
      const result = [
        getNativeCaptures(Reflect.get(iterator, "execute")) === undefined,
        !!getNativeCaptures(callback),
        callback(),
      ];
    `),
  ).toEqual([true, true, 2]);
});

it("exposes a mutable native cell after its creator returns", async () => {
  expect(
    await evaluateLowered(`
      const create = () => {
        let value = 1;
        return {
          read: () => value,
          write: (next) => {
            value = next;
          },
        };
      };
      const closure = create();
      const binding = getNativeCaptures(closure.read).bindings.find(
        (binding) => binding.name === "value"
      );
      const initial = binding.get();
      closure.write(9);
      const changed = closure.read();
      binding.set(initial);
      const result = [initial, changed, closure.read()];
    `),
  ).toEqual([1, 9, 1]);
});

it("exposes captures transitively without invoking the captured functions", async () => {
  expect(
    await evaluateLowered(`
      let calls = 0;
      let value = 2;
      const inner = () => {
        calls++;
        return value;
      };
      const outer = () => inner();
      const captured = getNativeCaptures(outer)
        .bindings.find((binding) => binding.name === "inner")
        .get();
      const binding = getNativeCaptures(captured).bindings.find(
        (binding) => binding.name === "value"
      );
      value = 4;
      binding.set(2);
      const result = [calls, outer(), calls];
    `),
  ).toEqual([0, 2, 1]);
});

it("registers declarations before calls that precede their declaration", async () => {
  expect(
    await evaluateLowered(`
      const before = getNativeCaptures(read);
      const result = [!!before, read()];
      function read() {
        return 3;
      }
    `),
  ).toEqual([true, 3]);
});

it("keeps getter creation lazy across lexical TDZ boundaries", async () => {
  expect(
    await evaluateLowered(`
      const read = () => value;
      const manifest = getNativeCaptures(read);
      let value = 5;
      const result = manifest.bindings
        .find((binding) => binding.name === "value")
        .get();
    `),
  ).toBe(5);
});

it("does not confuse inner shadows with creator bindings", async () => {
  expect(
    await evaluateLowered(`
      const value = 2;
      const read = () => {
        const value = 3;
        return () => value;
      };
      const inner = read();
      const result = [
        getNativeCaptures(read).bindings.map((binding) => binding.name),
        getNativeCaptures(inner)
          .bindings.find((binding) => binding.name === "value")
          .get(),
      ];
    `),
  ).toEqual([[], 3]);
});

it("preserves names, lengths, call receivers and construction", async () => {
  expect(
    await evaluateLowered(`
      const arrow = (value) => value;
      const object = {
        method: function (value) {
          return this.value + value;
        },
      };
      const Constructor = function (value) {
        this.value = value;
      };
      const named = function original(first, second) {};
      const result = [
        arrow.name,
        arrow.length,
        object.method.name,
        object.method.call({ value: 3 }, 4),
        new Constructor(5).value,
        named.name,
        named.length,
        Object.hasOwn(arrow, "prototype"),
      ];
    `),
  ).toEqual(["arrow", 1, "method", 7, 5, "original", 2, false]);
});

it("preserves names for prototype setters and bindings named __proto__", async () => {
  expect(
    await evaluateLowered(`
      const __proto__ = () => 1;
      const object = { __proto__: () => 2 };
      const computed = { ["__proto__"]: () => 3 };
      const result = [
        __proto__.name,
        Object.getPrototypeOf(object).name,
        computed.__proto__.name,
      ];
    `),
  ).toEqual(["__proto__", "", "__proto__"]);
});

it("exposes an arrow's lexical receiver without calling it", async () => {
  expect(
    await evaluateLowered(`
      const object = {
        value: 6,
        create: function () {
          return () => this.value;
        },
      };
      const closure = object.create();
      const capture = getNativeCaptures(closure).bindings.find(
        (binding) => binding.name === "[[ThisValue]]"
      );
      const result = [capture.get() === object, closure()];
    `),
  ).toEqual([true, 6]);
});

it("keeps ordinary arguments local and exposes lexical arguments as a root", async () => {
  expect(
    await evaluateLowered(`
      function create(value) {
        return () => arguments[0];
      }
      const closure = create(7);
      const result = [
        getNativeCaptures(create).ambientNames.includes("arguments"),
        getNativeCaptures(closure)
          .bindings.find((binding) => binding.name === "[[Arguments]]")
          .get()[0],
        closure(),
      ];
    `),
  ).toEqual([false, 7, 7]);
});

it("does not manufacture capture metadata for foreign callbacks or unported computed names", async () => {
  expect(
    await evaluateLowered(
      `
        let keys = 0;
        const object = { [(keys++, "callback")]: () => 2 };
        const result = [
          getNativeCaptures(foreign) === undefined,
          getNativeCaptures(object.callback) === undefined,
          object.callback.name,
          keys,
        ];
      `,
      { foreign: () => 1 },
    ),
  ).toEqual([true, true, "callback", 1]);
});

it("separates class field and static-block receivers from outer arrows", async () => {
  expect(
    await evaluateLowered(`
      const create = () =>
        class {
          value = this;
          read = () => this.value;
          static {
            this.read = () => this;
          }
        };
      const Constructor = create();
      const instance = new Constructor();
      const outer = getNativeCaptures(create).bindings;
      const instanceCapture = getNativeCaptures(instance.read).bindings.find(
        (binding) => binding.name === "[[ThisValue]]"
      );
      const staticCapture = getNativeCaptures(Constructor.read).bindings.find(
        (binding) => binding.name === "[[ThisValue]]"
      );
      const result = [
        outer.some((binding) => binding.name === "[[ThisValue]]"),
        instanceCapture.get() === instance,
        staticCapture.get() === Constructor,
        instance.read() === instance,
      ];
    `),
  ).toEqual([false, true, true, true]);
});

it.each([
  `() =>
      new (class {
        [this.key] = 1;
      })()`,
  `() =>
      new (class {
        [this.key]() {
          return 1;
        }
      })()`,
  `() => ({
      [this.key]() {
        return 1;
      },
    })`,
])("retains the outer receiver for computed keys in %s", async (closure) => {
  expect(
    await evaluateLowered(`
      function make() {
        return ${closure};
      }
      const receiver = { key: "value" };
      const create = make.call(receiver);
      const captured = getNativeCaptures(create).bindings.find(
        (binding) => binding.name === "[[ThisValue]]"
      );
      const instance = create();
      const value =
        typeof instance.value === "function" ? instance.value() : instance.value;
      const result = [!!captured && captured.get() === receiver, value];
    `),
  ).toEqual([true, 1]);
});

it("does not call getters on captured heap roots", async () => {
  expect(
    await evaluateLowered(`
      let reads = 0;
      const object = {
        get value() {
          reads++;
          return 1;
        },
      };
      const read = () => object.value;
      const root = getNativeCaptures(read)
        .bindings.find((binding) => binding.name === "object")
        .get();
      const result = [root === object, reads];
    `),
  ).toEqual([true, 0]);
});
