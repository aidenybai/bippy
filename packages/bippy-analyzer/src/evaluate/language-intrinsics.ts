import { createContext, runInContext } from "node:vm";
import { loadHostRealm } from "../host/host-realm.js";
import type { StaticValue } from "../types.js";
import {
  isSymbolPropertyKey,
  NULL_VALUE,
  primitiveValue,
  SYMBOL_PROPERTY_KEY_PREFIX,
} from "./values.js";

export const isObjectLike = (value: unknown): value is object =>
  (typeof value === "object" || typeof value === "function") && value !== null;

/**
 * The global object of a realm only the language has touched. This process
 * implements the same language, but the scripts it runs (the harness's own
 * React, a fixture mounted for its runtime tree) add members to its intrinsics
 * that the analyzed program never sees; a fresh realm's intrinsics are the
 * specification's alone.
 */
const LANGUAGE_GLOBAL: object = runInContext("globalThis", createContext());

const MAX_LANGUAGE_OBJECT_DEPTH = 4;

const collectLanguageObjects = (
  shared: unknown,
  language: unknown,
  objects: Map<object, object>,
  depth: number,
): void => {
  if (!isObjectLike(shared) || !isObjectLike(language) || objects.has(shared) || depth === 0)
    return;
  objects.set(shared, language);
  for (const key of Reflect.ownKeys(language)) {
    const languageMember = Object.getOwnPropertyDescriptor(language, key)?.value;
    const sharedMember = Object.getOwnPropertyDescriptor(shared, key)?.value;
    collectLanguageObjects(sharedMember, languageMember, objects, depth - 1);
  }
};

let languageObjects: Map<object, object> | null = null;

/** The language realm's counterpart of one of this process's intrinsics (`Symbol`, `Array.prototype`); null for any other object. */
export const getLanguageCounterpart = (shared: object): object | null => {
  if (languageObjects === null) {
    languageObjects = new Map();
    for (const name of loadHostRealm("ecmascript").getGlobalNames()) {
      collectLanguageObjects(
        Reflect.get(globalThis, name),
        Reflect.get(LANGUAGE_GLOBAL, name),
        languageObjects,
        MAX_LANGUAGE_OBJECT_DEPTH,
      );
    }
  }
  return languageObjects.get(shared) ?? null;
};

/** Whether the engine itself provides a global of this name; `WebAssembly` is one TypeScript declares only for hosts. */
export const isEngineGlobal = (name: string): boolean => Object.hasOwn(LANGUAGE_GLOBAL, name);

const isLanguageGlobal = (name: string, value: unknown): boolean =>
  loadHostRealm("ecmascript").hasGlobal(name) && Reflect.get(LANGUAGE_GLOBAL, name) === value;

/**
 * The canonical global path of a language object reached by another path, so
 * `Object.prototype.constructor` is `Object` and `Array.prototype.constructor.prototype`
 * is `Array.prototype`; null for objects only reachable by their own path.
 */
const getCanonicalLanguageGlobal = (value: object): StaticValue | null => {
  const ownName = Reflect.get(value, "name");
  if (typeof ownName === "string" && isLanguageGlobal(ownName, value))
    return { kind: "global", name: ownName };
  const constructor = Reflect.get(value, "constructor");
  if (
    typeof constructor === "function" &&
    constructor.prototype === value &&
    isLanguageGlobal(constructor.name, constructor)
  )
    return { kind: "global", name: `${constructor.name}.prototype` };
  return null;
};

/** The canonical global of one of this process's intrinsics (`String` for `Object("a").constructor`); null for any other object. */
export const getIntrinsicGlobal = (shared: object): StaticValue | null => {
  const language = getLanguageCounterpart(shared);
  return language === null ? null : getCanonicalLanguageGlobal(language);
};

/** The language global that is the `constructor` of a native prototype (`Array` for `Array.prototype`); null when the prototype is not an intrinsic's. */
export const getPrototypeConstructorGlobal = (prototype: object | null): StaticValue | null => {
  const constructor: unknown =
    prototype === null ? undefined : Reflect.get(prototype, "constructor");
  return isObjectLike(constructor) ? getIntrinsicGlobal(constructor) : null;
};

interface LanguagePathReading {
  readonly value: unknown;
}

/** What a dotted path starting at a language global holds in the language realm; null when the path starts elsewhere or breaks off. */
const readLanguagePath = (name: string): LanguagePathReading | null => {
  const [root, ...keys] = name.split(".");
  if (root === undefined || !loadHostRealm("ecmascript").hasGlobal(root)) return null;
  let value: unknown = Reflect.get(LANGUAGE_GLOBAL, root);
  for (const key of keys) {
    if (!isObjectLike(value)) return null;
    value = Reflect.get(value, key);
  }
  return { value };
};

/** The object or function a dotted language path (`Object.defineProperty`, `Array.prototype`) denotes, or null. */
export const getLanguageObject = (name: string): object | null => {
  const reading = readLanguagePath(name);
  return reading !== null && isObjectLike(reading.value) ? reading.value : null;
};

/** The property key a static key (`length`, `@@Symbol.toStringTag`) denotes on a language object; null for symbols the program allocated. */
export const toLanguagePropertyKey = (key: string): string | symbol | null => {
  if (!isSymbolPropertyKey(key)) return key;
  const reading = readLanguagePath(key.slice(SYMBOL_PROPERTY_KEY_PREFIX.length));
  return typeof reading?.value === "symbol" ? reading.value : null;
};

/**
 * A language value (`Math.PI`, `Symbol.iterator`, `Object.prototype.constructor`)
 * read from the language realm: constants become primitives and objects resolve to
 * their canonical global. Null when the path starts outside the language or
 * names an object without a canonical path.
 */
export const readLanguageValue = (name: string): StaticValue | null => {
  const reading = readLanguagePath(name);
  if (reading === null) return null;
  const { value } = reading;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "undefined":
      return primitiveValue(value);
    case "symbol":
      return { kind: "symbol", key: name };
    case "object":
    case "function":
      return value === null ? NULL_VALUE : getCanonicalLanguageGlobal(value);
  }
};
