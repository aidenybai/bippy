import { expect, it } from "vite-plus/test";
import { runInNewContext } from "node:vm";
import { evaluateLowered, evaluateNativeCaptures } from "./helpers/control-fixture.js";

it.each([false, true])(
  "restores a class-only lexical cell after its creator returns, first=%s",
  async (first) => {
    const source = `
    let prefixes = 0;
    function create() {
      prefixes++;
      let count = 0;
      class Reader { static read(choice) {count += choice ? 1 : 10; return count;} }
      return function* run() {const choice = yield 'pause'; return Reader.read(choice);};
    }
  `;
    const expected = [first, !first].map((choice) =>
      runInNewContext(
        `${source}; const iterator = create()(); iterator.next(); iterator.next(${choice}).value`,
      ),
    );
    expect(
      await evaluateLowered(`
    ${source}
    const iterator = create()();
    iterator.next();
    let ambient;
    const saved = captureControl(iterator, {capture(roots) {ambient = roots.ambientNames; return {restore() {}};}});
    const results = [];
    for (const choice of [${first}, ${!first}]) {
      saved.restore();
      results.push(iterator.next(choice).value);
    }
    const result = [results, prefixes, ambient.includes('[[ClassState]]')];
  `),
    ).toEqual([expected, 1, true]);
  },
);

it.each([
  "class Reader {read() {return count;}}",
  "const Reader = class {read() {return count;}}",
  "const Reader = class Inner {read() {return count;}}",
])("declares class lexical captures without replacing the constructor: %s", async (declaration) => {
  expect(
    await evaluateLowered(`
    let count = 2;
    ${declaration}
    const original = Reader;
    const descriptors = Object.getOwnPropertyDescriptors(Reader);
    const manifest = getNativeCaptures(Reader);
    const binding = manifest.bindings.find(binding => binding.name === 'count');
    const initial = binding.get();
    count = 9;
    const changed = new Reader().read();
    binding.set(initial);
    const result = [Reader === original, initial, changed, new Reader().read(),
      Reflect.ownKeys(Reader), Reflect.ownKeys(descriptors), manifest.ambientNames.includes('[[ClassState]]'),
      getNativeCaptures(Reader.prototype.read) === undefined];
  `),
  ).toEqual([
    true,
    2,
    9,
    2,
    ["length", "name", "prototype"],
    ["length", "name", "prototype"],
    true,
    true,
  ]);
});

it.each([false, true])(
  "does not hoist class registration across the TDZ or invoke getters and constructors: lowered=%s",
  async (isLowered) => {
    const evaluate = isLowered ? evaluateLowered : evaluateNativeCaptures;
    expect(
      await evaluate(`
    let calls = 0, before;
    try {before = Reader;} catch (error) {before = error.name;}
    class Reader {
      constructor() {calls++;}
      static get value() {calls++; return later;}
    }
    const manifest = getNativeCaptures(Reader);
    const binding = manifest.bindings.find(binding => binding.name === 'later');
    let error;
    try {binding.get();} catch (caught) {error = caught.name;}
    const later = 7;
    const result = [before, calls, error, binding.get(), binding.set === undefined];
  `),
    ).toEqual(["ReferenceError", 0, "ReferenceError", 7, true]);
  },
);

it("keeps class initialization, heritage, names, private state and computed-key order native", async () => {
  const program = `
    let calls = 0;
    const events = [];
    class Base {read() {return 3;}}
    const Reader = class extends (events.push('base'), Base) {
      #value = 4;
      [(events.push('key'), 'read')]() {return super.read() + this.#value;}
      static {events.push('static');}
      constructor() {super(); calls++;}
    };
    const instance = new Reader();
    const result = [Reader.name, Reader.length, instance.read(), events, calls,
      instance instanceof Base, Object.getPrototypeOf(Reader) === Base, Reflect.ownKeys(Reader)];
  `;
  expect(await evaluateLowered(program)).toEqual(runInNewContext(`${program}; result`));
});

it("marks private and class state as unowned and does not claim detached method captures", async () => {
  expect(
    await evaluateLowered(`
    let count = 2;
    class Reader {#value = 1; read() {return this.#value + count;}}
    const manifest = getNativeCaptures(Reader);
    const result = [manifest.ambientNames.includes('[[ClassState]]'),
      manifest.ambientNames.includes('[[PrivateEnvironment]]'),
      getNativeCaptures(Reader.prototype.read) === undefined];
  `),
  ).toEqual([true, true, true]);
});

it("does not mistake class-local shadows or the internal class name for outer cells", async () => {
  expect(
    await evaluateLowered(`
    let count = 8, Inner = 9, outside = 2;
    const Reader = class Inner {
      read(count) {let local = count; return [Inner, local, outside];}
    };
    const names = getNativeCaptures(Reader).bindings.map(binding => binding.name);
    const result = [names.includes('count'), names.includes('Inner'), names.includes('local'), names.includes('outside'), new Reader().read(3)[0] === Reader];
  `),
  ).toEqual([false, false, false, true, true]);
});

it("leaves escaped classes unregistered during static initialization", async () => {
  expect(
    await evaluateLowered(`
    let during, escaped;
    class Reader {static {escaped = this; during = getNativeCaptures(this);}}
    const result = [during === undefined, escaped === Reader, !!getNativeCaptures(escaped)];
  `),
  ).toEqual([true, true, true]);
});

it("leaves computed property name inference unchanged when registration is unsupported", async () => {
  expect(
    await evaluateLowered(`
    let calls = 0;
    const object = {[(calls++, 'Reader')]: class {}};
    const result = [object.Reader.name, calls, getNativeCaptures(object.Reader) === undefined];
  `),
  ).toEqual(["Reader", 1, true]);
});

it("preserves inferred names for assignments, defaults, fields and frozen constructors", async () => {
  const program = `
    let Assigned; Assigned = class {};
    const object = {Reader: class {}, __proto__: class {}};
    function create(Default = class {}) {return Default;}
    class Container {Field = class {}; static Static = class {};}
    const Frozen = class {static {Object.freeze(this);}};
    const result = [Assigned.name, object.Reader.name, Object.getPrototypeOf(object).name,
      create().name, new Container().Field.name, Container.Static.name, Frozen.name,
      Object.isFrozen(Frozen), Reflect.ownKeys(Frozen)];
  `;
  expect(await evaluateNativeCaptures(program)).toEqual(runInNewContext(`${program}; result`));
});

it("lets a rejecting owner refuse class storage before branch execution", async () => {
  expect(
    await evaluateLowered(`
    class Reader {static count = 0; static read() {return ++this.count;}}
    function* run() {yield; return Reader.read();}
    const iterator = run(); iterator.next();
    let rejected = false;
    try {
      captureControl(iterator, {capture(roots) {
        if (roots.ambientNames.includes('[[ClassState]]')) throw new Error('Unowned class state');
        return {restore() {}};
      }});
    } catch (error) {rejected = error.message === 'Unowned class state';}
    const result = [rejected, Reader.count, iterator.next().value];
  `),
  ).toEqual([true, 0, 1]);
});
