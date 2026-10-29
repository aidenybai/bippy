import type {
  Checker,
  IndexInfo,
  Signature,
  SignatureKind,
  Symbol,
  Type,
} from "typescript/unstable/sync";

const signaturesByType = new WeakMap<Type, Map<SignatureKind, readonly Signature[]>>();
const typesBySymbol = new WeakMap<Symbol, Type | undefined>();
const textsByType = new WeakMap<Type, string>();
const returnTypesBySignature = new WeakMap<Signature, Type | undefined>();
const propertiesByType = new WeakMap<Type, readonly Symbol[]>();
const propertyByNameByType = new WeakMap<Type, Map<string, Symbol | undefined>>();
const indexInfosByType = new WeakMap<Type, readonly IndexInfo[]>();
const isArrayByType = new WeakMap<Type, boolean>();
const isTupleByType = new WeakMap<Type, boolean>();

const getCached = <Key extends object, Value>(
  cache: WeakMap<Key, Value>,
  key: Key,
  compute: () => Value,
): Value => {
  if (cache.has(key)) return cache.get(key) as Value;
  const value = compute();
  cache.set(key, value);
  return value;
};

const getCachedByName = <Key extends object, Name, Value>(
  cache: WeakMap<Key, Map<Name, Value>>,
  key: Key,
  name: Name,
  compute: () => Value,
): Value => {
  const valuesByName = getCached(cache, key, () => new Map<Name, Value>());
  if (valuesByName.has(name)) return valuesByName.get(name) as Value;
  const value = compute();
  valuesByName.set(name, value);
  return value;
};

export const getSignaturesOfType = (
  checker: Checker,
  type: Type,
  kind: SignatureKind,
): readonly Signature[] =>
  getCachedByName(signaturesByType, type, kind, () => checker.getSignaturesOfType(type, kind));

export const getTypeOfSymbol = (checker: Checker, symbol: Symbol): Type | undefined =>
  getCached(typesBySymbol, symbol, () => checker.getTypeOfSymbol(symbol));

export const getTypeText = (checker: Checker, type: Type): string =>
  getCached(textsByType, type, () => checker.typeToString(type));

export const getReturnTypeOfSignature = (
  checker: Checker,
  signature: Signature,
): Type | undefined =>
  getCached(returnTypesBySignature, signature, () => checker.getReturnTypeOfSignature(signature));

export const getPropertiesOfType = (checker: Checker, type: Type): readonly Symbol[] =>
  getCached(propertiesByType, type, () => checker.getPropertiesOfType(type));

export const getPropertyOfType = (checker: Checker, type: Type, name: string): Symbol | undefined =>
  getCachedByName(propertyByNameByType, type, name, () => checker.getPropertyOfType(type, name));

export const getIndexInfosOfType = (checker: Checker, type: Type): readonly IndexInfo[] =>
  getCached(indexInfosByType, type, () => checker.getIndexInfosOfType(type));

export const isArrayType = (checker: Checker, type: Type): boolean =>
  getCached(isArrayByType, type, () => checker.isArrayType(type));

export const isTupleType = (checker: Checker, type: Type): boolean =>
  getCached(isTupleByType, type, () => checker.isTupleType(type));
