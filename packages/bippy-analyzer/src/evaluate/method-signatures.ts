import { loadHostRealm } from "../host/host-realm.js";
import type { HostMember } from "../host/realm-table.js";
import type { StaticValue } from "../types.js";

export const isPromiseMethodName = (name: string): boolean =>
  loadHostRealm("ecmascript").getMember("Promise", name)?.type.kind === "function";

/** Collection methods whose callback runs synchronously for every item, a shape the language shares across `Array`, `Map` and `Set`. */
const ITERATION_METHOD_NAMES = new Set(["map", "forEach", "flatMap", "filter"]);

/** Collection interfaces whose signatures stand for every list-like receiver's (`Array.filter(): T[]`, `IteratorObject.take(): IteratorObject<T>`). */
const LIST_INTERFACE_NAMES = ["Array", "IteratorObject"];

const getListMethod = (name: string): HostMember | null => {
  const language = loadHostRealm("ecmascript");
  for (const interfaceName of LIST_INTERFACE_NAMES) {
    const member = language.getMember(interfaceName, name);
    if (member?.type.kind === "function") return member;
  }
  return null;
};

/** `list.forEach(callback, thisArg)`: the callback runs with `this` set to the declared `thisArg` parameter (arrows keep their lexical `this`). */
export const bindCallbackThisArg = (name: string, args: StaticValue[]): StaticValue[] => {
  const thisArgIndex = getListMethod(name)?.parameterNames?.indexOf("thisArg") ?? -1;
  const [callback] = args;
  const thisArg = args[thisArgIndex];
  if (
    thisArgIndex < 1 ||
    thisArg === undefined ||
    callback?.kind !== "function" ||
    callback.boundThis
  )
    return args;
  return [{ ...callback, boundThis: thisArg }, ...args.slice(thisArgIndex + 1)];
};

/** Methods whose callbacks run synchronously (or on promise settlement) even when the receiver is opaque. */
export const isModeledOpaqueMethodName = (name: string): boolean =>
  isPromiseMethodName(name) || ITERATION_METHOD_NAMES.has(name);

/** Methods declared to return the receiver's own items (`filter`, `slice`, `sort`), so an indefinite receiver stands for its own result. */
export const isListPreservingMethod = (name: string): boolean =>
  getListMethod(name)?.returnsReceiverItems === true;
