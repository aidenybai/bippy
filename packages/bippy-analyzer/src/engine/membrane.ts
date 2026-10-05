import {
  IsCallable,
  IsConstructor,
  ObjectValue,
  SymbolValue,
  Value,
  wellKnownSymbols,
} from "#engine";
import { EngineApplicationError, EngineRuntime, getPrimitive } from "./engine-runtime.js";
import { EngineUnsupportedError } from "./unsupported.js";

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";
const isConstructor = (value: unknown): boolean => {
  if (typeof value !== "function") return false;
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
};
const createHostTarget = (array: boolean, callable: boolean, constructible: boolean): object =>
  array ? [] : constructible ? class {}.bind(null) : callable ? () => {} : {};

export class EngineMembrane {
  private readonly engineValues = new WeakMap<object, ObjectValue>();
  private readonly hostValues = new WeakMap<ObjectValue, object>();
  private readonly foreign = new WeakSet<ObjectValue>();
  private readonly engineSymbols = new Map<symbol, SymbolValue>();
  private readonly hostSymbols = new Map<SymbolValue, symbol>();
  private readonly reflect: ObjectValue;
  private readonly operations = new Map<string, Value>();
  private readonly createTarget: ObjectValue;
  private readonly createProxy: ObjectValue;
  private readonly symbolConstructor: ObjectValue;

  constructor(readonly engine: EngineRuntime) {
    this.reflect = engine.getObject(engine.evaluate("Reflect"));
    this.symbolConstructor = engine.getObject(engine.evaluate("Symbol"));
    this.createTarget = engine.getObject(
      engine.evaluate(
        "(array,callable,constructible)=>array?[]:constructible?(class {}).bind(null):callable?()=>{}:{}",
      ),
    );
    this.createProxy = engine.getObject(
      engine.evaluate("(target,handler)=>new Proxy(target,handler)"),
    );
    for (const [name, symbol] of Object.entries(wellKnownSymbols)) {
      const native: unknown = Reflect.get(Symbol, name);
      if (typeof native === "symbol") {
        this.engineSymbols.set(native, symbol);
        this.hostSymbols.set(symbol, native);
      }
    }
    for (const name of [
      "Object",
      "Function",
      "Array",
      "String",
      "Number",
      "Boolean",
      "BigInt",
      "Symbol",
      "Error",
      "TypeError",
      "RangeError",
      "ReferenceError",
      "SyntaxError",
      "EvalError",
      "URIError",
      "AggregateError",
      "Map",
      "Set",
      "WeakMap",
      "WeakSet",
      "Promise",
      "RegExp",
    ]) {
      const native: unknown = Reflect.get(globalThis, name);
      if (typeof native !== "function") continue;
      this.link(native, engine.getObject(engine.evaluate(name)));
      const prototype: unknown = Reflect.get(native, "prototype");
      const interpreted = engine.evaluate(`${name}.prototype`);
      if (isObject(prototype) && interpreted instanceof ObjectValue)
        this.link(prototype, interpreted);
    }
    for (const source of ["async()=>{}", "function*(){}", "async function*(){}"]) {
      const native: unknown = new Function(`return (${source}).constructor`)();
      if (typeof native !== "function") throw new Error("Expected function constructor");
      this.link(native, engine.getObject(engine.evaluate(`(${source}).constructor`)));
      this.link(
        Reflect.get(native, "prototype"),
        engine.getObject(engine.evaluate(`(${source}).constructor.prototype`)),
      );
    }
  }

  link = (host: object, interpreted: ObjectValue): void => {
    this.engineValues.set(host, interpreted);
    this.hostValues.set(interpreted, host);
  };

  getHostObject = (value: Value): object | undefined =>
    value instanceof ObjectValue && this.foreign.has(value)
      ? this.hostValues.get(value)
      : undefined;

  private operation = (name: string, args: Value[]): Value => {
    let operation = this.operations.get(name);
    if (!operation) {
      operation = this.engine.get(this.reflect, name);
      this.operations.set(name, operation);
    }
    return this.engine.call(operation, args);
  };
  private toKey = (key: Value): string | symbol => {
    const result = this.toHost(key);
    if (typeof result !== "string" && typeof result !== "symbol")
      throw new Error("Invalid membrane property key");
    return result;
  };
  private fromDescriptor = (descriptor: PropertyDescriptor): ObjectValue =>
    this.engine.createRecord(
      Object.entries(descriptor).map(([key, value]) => [key, this.toEngine(value)]),
    );
  private toDescriptor = (descriptor: Value): PropertyDescriptor | undefined => {
    if (descriptor === Value.undefined) return undefined;
    const entries = this.engine
      .getDataEntries(descriptor)
      .map(([key, value]) => [key, this.toHost(value)]);
    return Object.fromEntries(entries);
  };

  toEngine = (value: unknown): Value => {
    if (typeof value === "symbol") {
      const previous = this.engineSymbols.get(value);
      if (previous) return previous;
      const key = Symbol.keyFor(value);
      const symbol =
        key === undefined
          ? new SymbolValue(value.description)
          : this.engine.call(this.engine.get(this.symbolConstructor, "for"), [Value(key)]);
      if (!(symbol instanceof SymbolValue)) throw new Error("Expected engine symbol");
      this.engineSymbols.set(value, symbol);
      this.hostSymbols.set(symbol, value);
      return symbol;
    }
    if (!isObject(value)) return this.engine.createPrimitive(value);
    const previous = this.engineValues.get(value);
    if (previous) return previous;
    const target = this.engine.getObject(
      this.engine.call(this.createTarget, [
        Value(Array.isArray(value)),
        Value(typeof value === "function"),
        Value(isConstructor(value)),
      ]),
    );
    const syncProperty = (key: string | symbol): PropertyDescriptor | undefined => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      const engineKey = this.toEngine(key);
      if (!descriptor) this.operation("deleteProperty", [target, engineKey]);
      else if (!descriptor.configurable || !Reflect.isExtensible(value))
        this.operation("defineProperty", [target, engineKey, this.fromDescriptor(descriptor)]);
      return descriptor;
    };
    const synchronize = (): void => {
      const keys = Reflect.ownKeys(value);
      for (const key of this.engine.getArray(this.operation("ownKeys", [target])).map(this.toKey))
        if (!keys.includes(key)) this.operation("deleteProperty", [target, this.toEngine(key)]);
      for (const key of keys) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (descriptor)
          this.operation("defineProperty", [
            target,
            this.toEngine(key),
            this.fromDescriptor(descriptor),
          ]);
      }
      this.operation("setPrototypeOf", [target, this.toEngine(Reflect.getPrototypeOf(value))]);
      if (!Reflect.isExtensible(value)) this.operation("preventExtensions", [target]);
    };
    const handlers: Array<[string, (args: Value[]) => Value]> = [
      [
        "get",
        ([, key, receiver]) =>
          this.toEngine(Reflect.get(value, this.toKey(key), this.toHost(receiver))),
      ],
      [
        "set",
        ([, key, next, receiver]) =>
          Value(Reflect.set(value, this.toKey(key), this.toHost(next), this.toHost(receiver))),
      ],
      ["has", ([, key]) => Value(Reflect.has(value, this.toKey(key)))],
      [
        "deleteProperty",
        ([, key]) => {
          const result = Reflect.deleteProperty(value, this.toKey(key));
          syncProperty(this.toKey(key));
          return Value(result);
        },
      ],
      [
        "ownKeys",
        () => {
          if (!Reflect.isExtensible(value)) synchronize();
          return this.engine.createArray(Reflect.ownKeys(value).map(this.toEngine));
        },
      ],
      [
        "getOwnPropertyDescriptor",
        ([, key]) => {
          const descriptor = syncProperty(this.toKey(key));
          return descriptor ? this.fromDescriptor(descriptor) : Value.undefined;
        },
      ],
      [
        "defineProperty",
        ([, key, descriptor]) => {
          const result = Reflect.defineProperty(
            value,
            this.toKey(key),
            this.toDescriptor(descriptor) ?? {},
          );
          syncProperty(this.toKey(key));
          return Value(result);
        },
      ],
      [
        "getPrototypeOf",
        () => {
          if (!Reflect.isExtensible(value)) synchronize();
          return this.toEngine(Reflect.getPrototypeOf(value));
        },
      ],
      [
        "setPrototypeOf",
        ([, prototype]) => {
          const next = this.toHost(prototype);
          if (next !== null && !isObject(next)) throw new TypeError("Invalid prototype");
          return Value(Reflect.setPrototypeOf(value, next));
        },
      ],
      [
        "isExtensible",
        () => {
          const result = Reflect.isExtensible(value);
          if (!result) synchronize();
          return Value(result);
        },
      ],
      [
        "preventExtensions",
        () => {
          const result = Reflect.preventExtensions(value);
          synchronize();
          return Value(result);
        },
      ],
      [
        "apply",
        ([, receiver, args]) => {
          if (typeof value !== "function") throw new TypeError("Not callable");
          return this.toEngine(
            Reflect.apply(
              value,
              this.toHost(receiver),
              this.engine.getArray(args).map(this.toHost),
            ),
          );
        },
      ],
      [
        "construct",
        ([, args, newTarget]) => {
          const constructor = this.toHost(newTarget);
          if (typeof value !== "function" || typeof constructor !== "function")
            throw new TypeError("Not constructible");
          return this.toEngine(
            Reflect.construct(value, this.engine.getArray(args).map(this.toHost), constructor),
          );
        },
      ],
    ];
    const handler = this.engine.createRecord(
      handlers.map(([name, run]) => [
        name,
        this.engine.createFunction(name, (args) => {
          try {
            return run(args);
          } catch (error) {
            if (error instanceof EngineApplicationError || error instanceof EngineUnsupportedError)
              throw error;
            if (this.engine.isFailed) throw error;
            throw new EngineApplicationError(this.toEngine(error));
          }
        }),
      ]),
    );
    const proxy = this.engine.getObject(this.engine.call(this.createProxy, [target, handler]));
    this.link(value, proxy);
    this.foreign.add(proxy);
    return proxy;
  };

  toHost = (value: Value): unknown => {
    if (value instanceof SymbolValue) {
      const previous = this.hostSymbols.get(value);
      if (previous) return previous;
      const key = this.engine.call(this.engine.get(this.symbolConstructor, "keyFor"), [value]);
      const symbol = key.type === "String" ? Symbol.for(key.value) : Symbol(value.Description);
      this.hostSymbols.set(value, symbol);
      this.engineSymbols.set(symbol, value);
      return symbol;
    }
    if (!(value instanceof ObjectValue)) return getPrimitive(value);
    const previous = this.hostValues.get(value);
    if (previous) return previous;
    const target = createHostTarget(
      this.engine.isArray(value),
      IsCallable(value),
      IsConstructor(value),
    );
    const run = (name: string, args: unknown[]): unknown =>
      this.toHost(this.operation(name, [value, ...args.map(this.toEngine)]));
    const descriptorFor = (key: string | symbol): PropertyDescriptor | undefined =>
      this.toDescriptor(this.operation("getOwnPropertyDescriptor", [value, this.toEngine(key)]));
    const syncProperty = (key: string | symbol): PropertyDescriptor | undefined => {
      const descriptor = descriptorFor(key);
      if (!descriptor) Reflect.deleteProperty(target, key);
      else if (!descriptor.configurable || !run("isExtensible", []))
        Reflect.defineProperty(target, key, descriptor);
      return descriptor;
    };
    const keys = (): Array<string | symbol> =>
      this.engine.getArray(this.operation("ownKeys", [value])).map(this.toKey);
    const synchronize = (): void => {
      const sourceKeys = keys();
      for (const key of Reflect.ownKeys(target))
        if (!sourceKeys.includes(key)) Reflect.deleteProperty(target, key);
      for (const key of sourceKeys) {
        const descriptor = descriptorFor(key);
        if (descriptor) Reflect.defineProperty(target, key, descriptor);
      }
      const prototype = run("getPrototypeOf", []);
      if (prototype !== null && !isObject(prototype)) throw new TypeError("Invalid prototype");
      Reflect.setPrototypeOf(target, prototype);
      if (!run("isExtensible", [])) Reflect.preventExtensions(target);
    };
    const handler: ProxyHandler<object> = {
      get: (_target, key, receiver) => run("get", [key, receiver]),
      set: (_target, key, next, receiver) => Boolean(run("set", [key, next, receiver])),
      has: (_target, key) => Boolean(run("has", [key])),
      deleteProperty: (_target, key) => {
        const result = Boolean(run("deleteProperty", [key]));
        syncProperty(key);
        return result;
      },
      ownKeys: () => {
        if (!run("isExtensible", [])) synchronize();
        return keys();
      },
      getOwnPropertyDescriptor: (_target, key) => syncProperty(key),
      defineProperty: (_target, key, descriptor) => {
        const result = Boolean(run("defineProperty", [key, descriptor]));
        syncProperty(key);
        return result;
      },
      getPrototypeOf: () => {
        if (!run("isExtensible", [])) synchronize();
        const prototype = run("getPrototypeOf", []);
        if (prototype !== null && !isObject(prototype)) throw new TypeError("Invalid prototype");
        return prototype;
      },
      setPrototypeOf: (_target, prototype) => Boolean(run("setPrototypeOf", [prototype])),
      isExtensible: () => {
        const result = Boolean(run("isExtensible", []));
        if (!result) synchronize();
        return result;
      },
      preventExtensions: () => {
        const result = Boolean(run("preventExtensions", []));
        synchronize();
        return result;
      },
      apply: (_target, receiver, args) => run("apply", [receiver, args]),
      construct: (_target, args, newTarget) => {
        const result = run("construct", [args, newTarget]);
        if (!isObject(result)) throw new TypeError("Constructor returned a primitive");
        return result;
      },
    };
    const guarded = Object.fromEntries(
      Object.entries(handler).map(([name, callback]) => [
        name,
        (...args: unknown[]) => {
          try {
            return Reflect.apply(callback, undefined, args);
          } catch (error) {
            if (error instanceof EngineApplicationError) throw this.toHost(error.value);
            throw error;
          }
        },
      ]),
    );
    const proxy = new Proxy(target, guarded);
    this.link(proxy, value);
    return proxy;
  };
}
