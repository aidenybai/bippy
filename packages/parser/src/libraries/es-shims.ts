import { UNDEFINED_VALUE } from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { LibraryValueProvider, StaticValue } from "../types.js";

// es-shims packages (`object.entries`, `array.prototype.foreach`, ...) export
// the native they polyfill, call-bound so the receiver is the first argument;
// `has`/`hasown` are `Object.prototype.hasOwnProperty` bound the same way. The
// call is dispatched to the interpreter's own builtin, not a model of it.

interface EsShim {
  /** The global the method hangs off (`Object`); null for a prototype method whose receiver is the first argument. */
  globalName: string | null;
  methodName: string;
}

const SHIMMED_GLOBALS: Record<string, object> = {
  Array,
  Function,
  Math,
  Number,
  Object,
  Promise,
  Reflect,
  RegExp,
  String,
  Symbol,
};

const SHIMMED_PROTOTYPES: Record<string, object> = {
  Array: Array.prototype,
  Function: Function.prototype,
  Number: Number.prototype,
  Object: Object.prototype,
  Promise: Promise.prototype,
  RegExp: RegExp.prototype,
  String: String.prototype,
  Symbol: Symbol.prototype,
};

const methodNamesOf = (object: object): string[] =>
  Object.entries(Object.getOwnPropertyDescriptors(object))
    .filter(
      ([name, descriptor]) => typeof descriptor.value === "function" && name !== "constructor",
    )
    .map(([name]) => name);

const ES_SHIMS: ReadonlyMap<string, EsShim> = new Map([
  ...Object.entries(SHIMMED_GLOBALS).flatMap(([globalName, object]) =>
    methodNamesOf(object).map((methodName): [string, EsShim] => [
      `${globalName.toLowerCase()}.${methodName.toLowerCase()}`,
      { globalName, methodName },
    ]),
  ),
  ...Object.entries(SHIMMED_PROTOTYPES).flatMap(([globalName, prototype]) =>
    methodNamesOf(prototype).map((methodName): [string, EsShim] => [
      `${globalName.toLowerCase()}.prototype.${methodName.toLowerCase()}`,
      { globalName: null, methodName },
    ]),
  ),
  ["has", { globalName: null, methodName: "hasOwnProperty" }],
  ["hasown", { globalName: null, methodName: "hasOwnProperty" }],
]);

export const ES_SHIM_PACKAGES: readonly string[] = [...ES_SHIMS.keys()];

const shimValue = (packageName: string, { globalName, methodName }: EsShim): StaticValue =>
  nativeFunction(packageName, ([receiver = UNDEFINED_VALUE, ...rest], tools) =>
    globalName === null
      ? tools.call({ kind: "method", receiver, name: methodName }, rest)
      : tools.call({ kind: "global", name: `${globalName}.${methodName}` }, [receiver, ...rest]),
  );

export const esShimValue: LibraryValueProvider = (specifier, importedName) => {
  const shim = ES_SHIMS.get(specifier);
  if (!shim || (importedName !== "default" && importedName !== "*")) return null;
  return shimValue(specifier, shim);
};
