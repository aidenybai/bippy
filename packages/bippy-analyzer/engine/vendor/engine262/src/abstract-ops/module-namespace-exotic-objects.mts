import { Q, X } from '../completion.mts';
import { AbstractModuleRecord, CyclicModuleRecord, ResolvedBindingRecord } from '../modules.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import type { ImportedNamesValue } from '../static-semantics/ModuleRequests.mts';
import {
  SymbolValue,
  Value,
  Descriptor,
  wellKnownSymbols,
  JSStringValue,
  type ObjectInternalMethods,
  UndefinedValue,
  type PropertyKeyValue,
  ObjectValue,
} from '../value.mts';
import { type Mutable } from '../utils/language.mts';
import {
  Assert,
  CompareArrayElements,
  SameValue,
  MakeBasicObject,
  IsPropertyKey,
  IsAccessorDescriptor,
  SetImmutablePrototype,
  OrdinaryGetOwnProperty,
  OrdinaryDefineOwnProperty,
  OrdinaryHasProperty,
  OrdinaryGet,
  OrdinaryDelete,
  OrdinaryOwnPropertyKeys,
  GetModuleNamespace, R,
  type ExoticObject,
  EvaluateModuleSync,
} from './all.mts';
import { Throw, type FullyPopulatedDescriptor } from '#self';

export interface ModuleNamespaceObject extends ExoticObject {
  readonly Module: AbstractModuleRecord;
  readonly Exports: Set<string>;
  readonly Deferred: boolean;
}

export function isModuleNamespaceObject(V: Value): V is ModuleNamespaceObject {
  return V instanceof ObjectValue && 'Module' in V;
}

const InternalMethods = {
  * GetPrototypeOf() {
    return Value.null;
  },
  * SetPrototypeOf(V) {
    return Q(yield* SetImmutablePrototype(this, V));
  },
  * IsExtensible() {
    return false;
  },
  * PreventExtensions() {
    return true;
  },
  * GetOwnProperty(propertyKey: string | PropertyKeyValue): PlainEvaluator<FullyPopulatedDescriptor | undefined> {
    const obj = this;

    if (IsSymbolLikeNamespaceKey(propertyKey, obj)) {
      return OrdinaryGetOwnProperty(obj, propertyKey);
    }
    if (typeof propertyKey !== 'string') propertyKey = propertyKey.stringValue();
    const exports = Q(yield* GetModuleExportsList(obj));
    if (!exports.has(propertyKey)) {
      return undefined;
    }
    const value = Q(yield* obj.Get(propertyKey, obj));
    return Descriptor({
      Value: value,
      Writable: true,
      Enumerable: true,
      Configurable: false,
    });
  },
  * DefineOwnProperty(P, Desc): PlainEvaluator<boolean> {
    const O = this;

    if (IsSymbolLikeNamespaceKey(P, O)) {
      return yield* OrdinaryDefineOwnProperty(O, P, Desc);
    }

    const current = Q(yield* O.GetOwnProperty(P));
    if (current === undefined) {
      return false;
    }
    if (IsAccessorDescriptor(Desc)) {
      return false;
    }
    if (Desc.Writable !== undefined && !Desc.Writable) {
      return false;
    }
    if (Desc.Enumerable !== undefined && !Desc.Enumerable) {
      return false;
    }
    if (Desc.Configurable !== undefined && Desc.Configurable) {
      return false;
    }
    if (Desc.Value !== undefined) {
      return SameValue(Desc.Value, current.Value!);
    }
    return true;
  },
  * HasProperty(propertyKey): PlainEvaluator<boolean> {
    const obj = this;

    if (IsSymbolLikeNamespaceKey(propertyKey, obj)) {
      return yield* OrdinaryHasProperty(obj, propertyKey);
    }
    if (typeof propertyKey !== 'string') propertyKey = propertyKey.stringValue();
    const exports = Q(yield* GetModuleExportsList(obj));
    if (exports.has(propertyKey)) {
      return true;
    }
    return false;
  },
  /** https://tc39.es/ecma262/#sec-module-namespace-exotic-objects-get-p-receiver */
  * Get(propertyKey, Receiver) {
    const O = this;

    if (propertyKey instanceof JSStringValue) propertyKey = propertyKey.stringValue();
    Assert(typeof propertyKey === 'string' || IsPropertyKey(propertyKey));
    // 1. If IsSymbolLikeNamespaceKey(P, O), return ! OrdinaryGet(O, P, Receiver).
    if (IsSymbolLikeNamespaceKey(propertyKey, O)) {
      return X(yield* OrdinaryGet(O, propertyKey, Receiver));
    }
    // 2. Let exports be ? GetModuleExportsList(O).
    const exports = Q(yield* GetModuleExportsList(O));
    // 3. If exports does not contain P, return undefined.
    if (!exports.has(propertyKey)) {
      return Value.undefined;
    }
    // 4. Let m be O.[[Module]].
    const m = O.Module;
    // 5. If m is a Cyclic Module Record and m.GetOptionalIndirectExportsModuleRequests(« P ») is not empty, then
    if (m instanceof CyclicModuleRecord) {
      const importedNames: ImportedNamesValue = [propertyKey];
      if (m.GetOptionalIndirectExportsModuleRequests(importedNames).length > 0) {
        // a. Perform ? EvaluateModuleSync(m, « P »).
        Q(yield* EvaluateModuleSync(m, importedNames));
      }
    }
    // 6. Let binding be m.ResolveExport(P).
    const binding = m.ResolveExport(propertyKey);
    // 7. Assert: binding is a ResolvedBinding Record.
    Assert(binding instanceof ResolvedBindingRecord);
    // 8. Let targetModule be binding.[[Module]].
    const targetModule = binding.Module;
    // 9. Assert: targetModule is not undefined.
    Assert(!(targetModule instanceof UndefinedValue));
    // 10. If binding.[[BindingName]] is namespace, then
    if (binding.BindingName === 'namespace') {
      return GetModuleNamespace(targetModule, 'evaluation', 'all');
    }
    if (binding.BindingName === 'source') {
      Assert(!!targetModule.ModuleSource);
      return targetModule.ModuleSource;
    }
    // 11. If binding.[[BindingName]] is deferred-namespace, then
    if (binding.BindingName === 'deferred-namespace') {
      return GetModuleNamespace(targetModule, 'defer', 'all');
    }
    // 12. Let targetEnv be targetModule.[[Environment]].
    const targetEnv = targetModule.Environment;
    // 13. If targetEnv is empty, throw a ReferenceError exception.
    if (!targetEnv) {
      return Throw.ReferenceError('$1 is not defined', propertyKey);
    }
    // 14. Return ? targetEnv.GetBindingValue(binding.[[BindingName]], true).
    return Q(yield* targetEnv.GetBindingValue(binding.BindingName.stringValue(), true));
  },
  * Set() {
    return false;
  },
  * Delete(propertyKey): PlainEvaluator<boolean> {
    const obj = this;

    if (propertyKey instanceof JSStringValue) propertyKey = propertyKey.stringValue();
    Assert(typeof propertyKey === 'string' || IsPropertyKey(propertyKey));
    if (IsSymbolLikeNamespaceKey(propertyKey, obj)) {
      return Q(yield* OrdinaryDelete(obj, propertyKey));
    }
    const exports = Q(yield* GetModuleExportsList(obj));
    if (exports.has(propertyKey)) {
      return false;
    }
    return true;
  },
  * OwnPropertyKeys(): PlainEvaluator<PropertyKeyValue[]> {
    const O = this;

    let exports;
    exports = Q(yield* GetModuleExportsList(O));
    if (O.Deferred && exports.has('then')) {
      exports = [...exports].filter((x) => x !== 'then');
    }

    const symbolKeys = X(OrdinaryOwnPropertyKeys(O));
    return [...[...exports].map(Value) as PropertyKeyValue[], ...symbolKeys];
  },
} satisfies Partial<ObjectInternalMethods<ModuleNamespaceObject>>;

/** https://tc39.es/ecma262/#sec-modulenamespacecreate */
export function ModuleNamespaceCreate(
  module: AbstractModuleRecord,
  exports: readonly string[],
  phase: 'defer' | 'evaluation',
): ModuleNamespaceObject {
  // 2. Let internalSlotsList be the internal slots listed in Table 31.
  const internalSlotsList = ['Module', 'Exports'];
  // 3. Let M be MakeBasicObject(internalSlotsList).
  const M = MakeBasicObject(internalSlotsList) as Mutable<ModuleNamespaceObject>;
  // 4. Set M's essential internal methods to the definitions specified in 10.4.6.
  /** https://tc39.es/ecma262/#sec-module-namespace-exotic-objects */
  M.GetPrototypeOf = InternalMethods.GetPrototypeOf;
  M.SetPrototypeOf = InternalMethods.SetPrototypeOf;
  M.IsExtensible = InternalMethods.IsExtensible;
  M.PreventExtensions = InternalMethods.PreventExtensions;
  M.GetOwnProperty = InternalMethods.GetOwnProperty;
  M.DefineOwnProperty = InternalMethods.DefineOwnProperty;
  M.HasProperty = InternalMethods.HasProperty;
  M.Get = InternalMethods.Get;
  M.Set = InternalMethods.Set;
  M.Delete = InternalMethods.Delete;
  M.OwnPropertyKeys = InternalMethods.OwnPropertyKeys;
  // 5. Set M.[[Module]] to module.
  M.Module = module;
  // 6. Let sortedExports be a List whose elements are the elements of exports, sorted according to lexicographic code unit order.
  const sortedExports: string[] = [...exports].sort((x, y) => {
    const result = X(CompareArrayElements(Value(x), Value(y), Value.undefined));
    return R(result);
  });
  // 7. Set M.[[Exports]] to sortedExports.
  M.Exports = new Set(sortedExports);
  let toStringTag: string;
  // 9. If phase is defer, then
  if (phase === 'defer') {
    M.Deferred = true;
    toStringTag = 'Deferred Module';
  } else { // 10. Else,
    M.Deferred = false;
    toStringTag = 'Module';
  }
  // 11. Create an own data property of M named %Symbol.toStringTag% whose [[Value]] is toStringTag whose [[Writable]], [[Enumerable]], and [[Configurable]] attributes are false.
  M.properties.set(wellKnownSymbols.toStringTag, Descriptor({
    Writable: false,
    Enumerable: false,
    Configurable: false,
    Value: Value(toStringTag),
  }));
  // 10. Return M.
  return M;
}

/** https://tc39.es/proposal-defer-import-eval/#sec-IsSymbolLikeNamespaceKey */
function IsSymbolLikeNamespaceKey(P: PropertyKeyValue | string, ns: ModuleNamespaceObject): P is SymbolValue {
  if (P instanceof SymbolValue) {
    return true;
  }
  if (ns.Deferred && (P === 'then' || (P instanceof JSStringValue && P.stringValue() === 'then'))) {
    return true;
  }
  return false;
}

/** https://tc39.es/proposal-defer-import-eval/#sec-GetModuleExportsList */
function* GetModuleExportsList(O: ModuleNamespaceObject): PlainEvaluator<Set<string>> {
  // 1. If O.[[Deferred]] is true, then
  if (O.Deferred) {
    // a. Let m be O.[[Module]].
    const m = O.Module;
    // b. Perform ? EvaluateModuleSync(m).
    Q(yield* EvaluateModuleSync(m));
  }
  // 2. Return O.[[Exports]].
  return O.Exports;
}
