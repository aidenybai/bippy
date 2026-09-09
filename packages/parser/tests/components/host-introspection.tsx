import * as helpers from "./shared/index.js";

declare const global: typeof globalThis;

/** lodash `_root`: `global`, `self` and a `Function("return this")()` fallback. */
const freeGlobal = typeof global === "object" && global && global.Object === Object && global;
const freeSelf = typeof self === "object" && self && self.Object === Object && self;
const root = freeGlobal || freeSelf;
const rootIsWindow = root === window;

/** lodash `_baseIsNative` / `_toSource`: native functions print `[native code]`. */
const funcToString = Function.prototype.toString;
const reIsNative = /^function [A-Za-z_$][\w$]*\(\) \{ \[native code\] \}$/;
const createSource = funcToString.call(Object.create);
const isCreateNative = reIsNative.test(createSource);
const typeofCreate = typeof Object.create;

/** lodash `isPlainObject`: `Object.getPrototypeOf` on plain objects, arrays and functions. */
const protoOfPlain = Object.getPrototypeOf({}) === Object.prototype;
const protoOfArray = Object.getPrototypeOf([]) === Array.prototype;
const protoOfFunction = Object.getPrototypeOf(() => null) === Function.prototype;
const protoOfObjectPrototype = Object.getPrototypeOf(Object.prototype);
const hasOwnConstructor = Object.prototype.hasOwnProperty.call(Object.prototype, "constructor");

/** lodash `_getRawTag` / `Symbol.toStringTag` guards on builtin prototypes. */
const ownsToString = "toString" in Object.prototype;
const ownsIterator = Symbol.iterator in Array.prototype;
const ownsValueOf = "valueOf" in Object.prototype;

/** lodash `_overRest`: rest arity derives from `fn.length`. */
const arity = (first: number, second: number) => first + second;
const arityWithDefault = (first: number, second = 1, ...rest: number[]) =>
  first + second + rest.length;
const boundArity = arity.bind(null, 1).length;

/** lodash `Object(value)`: boxes primitives, returns objects unchanged. */
const source = { legends: 1 };
const boxedSame = Object(source) === source;
const boxedNull = Object.keys(Object(null)).length;

/** A missing named export of a fully analyzed module reads as `undefined`. */
const missingExport = typeof (helpers as { notExported?: unknown }).notExported;

export default function HostIntrospection() {
  return (
    <dl>
      <dt>root</dt>
      <dd>{String(rootIsWindow)}</dd>
      <dt>native</dt>
      <dd>
        {createSource}/{String(isCreateNative)}/{typeofCreate}
      </dd>
      <dt>prototypes</dt>
      <dd>
        {String(protoOfPlain)}/{String(protoOfArray)}/{String(protoOfFunction)}/
        {String(protoOfObjectPrototype)}/{String(hasOwnConstructor)}
      </dd>
      <dt>in</dt>
      <dd>
        {String(ownsToString)}/{String(ownsIterator)}/{String(ownsValueOf)}
      </dd>
      <dt>arity</dt>
      <dd>
        {arity.length}/{arityWithDefault.length}/{boundArity}
      </dd>
      <dt>boxing</dt>
      <dd>
        {String(boxedSame)}/{boxedNull}
      </dd>
      <dt>module</dt>
      <dd>{missingExport}</dd>
    </dl>
  );
}
