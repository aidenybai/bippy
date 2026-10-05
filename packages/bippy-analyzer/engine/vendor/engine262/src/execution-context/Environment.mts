import { AbstractModuleRecord } from '../modules.mts';
import {
  Descriptor,
  ReferenceRecord,
  UndefinedValue,
  ObjectValue,
  Value,
  wellKnownSymbols,
} from '../value.mts';
import { type GCMarker } from '../host-defined/engine.mts';
import type { DisposableResourceRecord } from '../abstract-ops/disposable-operations.mts';
import {
  NormalCompletion, Q, X,
  type ValueEvaluator,
} from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import {
  Assert,
  DefinePropertyOrThrow,
  Get,
  HasOwnProperty,
  HasProperty,
  IsDataDescriptor,
  IsExtensible,
  Set,
  ToBoolean,
  isECMAScriptFunctionObject,
  type ECMAScriptFunctionObject,
  Throw,
  type FunctionObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-environment-records */
export abstract class EnvironmentRecord {
  readonly OuterEnv: EnvironmentRecord | null;

  constructor(outerEnv: EnvironmentRecord | null) {
    this.OuterEnv = outerEnv;
  }

  abstract HasBinding(name: string): PlainEvaluator<boolean>;

  abstract CreateMutableBinding(name: string, deletable: boolean): PlainEvaluator;

  abstract CreateImmutableBinding(name: string, strict: boolean): void;

  abstract InitializeBinding(name: string, value: Value): PlainEvaluator;

  abstract SetMutableBinding(name: string, value: Value, strict: boolean): PlainEvaluator;

  abstract GetBindingValue(name: string, strict: boolean): ValueEvaluator;

  abstract DeleteBinding(name: string): PlainEvaluator<boolean>;

  abstract HasThisBinding(): boolean;

  abstract HasSuperBinding(): boolean;

  abstract WithBaseObject(): ObjectValue | UndefinedValue;

  // NON-SPEC
  mark(m: GCMarker) {
    m(this.OuterEnv);
  }
}

export interface DeclarativeEnvironmentBinding {
  readonly indirect: boolean;
  initialized: boolean;
  readonly mutable?: boolean;
  readonly strict?: boolean;
  readonly deletable?: boolean;
  value?: Value | undefined;

  mark(m: GCMarker): void;
}

export interface ModuleEnvironmentBinding extends DeclarativeEnvironmentBinding {
  readonly target?: [AbstractModuleRecord, string];
}

/**
 * The deferred-reexports proposal refers to a "deferred initialization binding"
 * but does not define a record structure for one.
 */
interface DeferredInitializationBinding extends ModuleEnvironmentBinding {
  readonly initializationSteps: () => Value;
}

function isDeferredInitializationBinding(binding: ModuleEnvironmentBinding): binding is DeferredInitializationBinding {
  return 'initializationSteps' in binding;
}

/** https://tc39.es/ecma262/#sec-declarative-environment-records */
export class DeclarativeEnvironmentRecord extends EnvironmentRecord {
  readonly bindings = new Map<string, DeclarativeEnvironmentBinding>();

  /** https://tc39.es/ecma262/#table-additional-fields-of-declarative-environment-records */
  readonly DisposableResourceStack: DisposableResourceRecord[] = [];

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-hasbinding-n */
  * HasBinding(name: string) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If envRec has a binding for the name that is the value of N, return true.
    if (envRec.bindings.has(name)) {
      return true;
    }
    // 3. Return false.
    return false;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-createmutablebinding-n-d */
  * CreateMutableBinding(name: string, deletable: boolean) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec does not already have a binding for N.
    Assert(!envRec.bindings.has(name));
    // 3. Create a mutable binding in envRec for N and record that it is uninitialized. If D
    //    is true, record that the newly created binding may be deleted by a subsequent
    //    DeleteBinding call.
    this.bindings.set(name, {
      indirect: false,
      initialized: false,
      mutable: true,
      strict: undefined,
      deletable: deletable,
      value: undefined,
      mark(m: GCMarker) {
        m(this.value);
      },
    });
    //  4. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-createimmutablebinding-n-s */
  CreateImmutableBinding(name: string, strict: boolean) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec does not already have a binding for N.
    Assert(!envRec.bindings.has(name));
    // 3. Create an immutable binding in envRec for N and record that it is uninitialized. If
    //    S is true, record that the newly created binding is a strict binding.
    this.bindings.set(name, {
      indirect: false,
      initialized: false,
      mutable: false,
      strict: strict,
      deletable: false,
      value: undefined,
      mark(m) {
        m(this.value);
      },
    });
    // 4. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-initializebinding-n-v */
  * InitializeBinding(name: string, value: Value) {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec must have an uninitialized binding for N.
    const binding = envRec.bindings.get(name);
    Assert(binding !== undefined && binding.initialized === false);
    // 3. Set the bound value for N in envRec to V.
    binding.value = value;
    // 4. Record that the binding for N in envRec has been initialized.
    binding.initialized = true;
    // 5. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-setmutablebinding-n-v-s */
  * SetMutableBinding(name: string, value: Value, strict: boolean): PlainEvaluator {
    Assert(typeof name === 'string');
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If envRec does not have a binding for N, then
    if (!envRec.bindings.has(name)) {
      // a. If S is true, throw a ReferenceError exception.
      if (strict) {
        return Throw.ReferenceError('$1 is not defined', name);
      }
      // b. Perform envRec.CreateMutableBinding(N, true).
      yield* envRec.CreateMutableBinding(name, true);
      // c. Perform envRec.InitializeBinding(N, V).
      yield* envRec.InitializeBinding(name, value);
      // d. Return NormalCompletion(empty).
      return NormalCompletion(undefined);
    }
    const binding = this.bindings.get(name)!;
    // 3. If the binding for N in envRec is a strict binding, set S to true.
    if (binding.strict === true) {
      strict = true;
    }
    // 4. If the binding for N in envRec has not yet been initialized, throw a ReferenceError exception.
    if (binding.initialized === false) {
      return Throw.ReferenceError('$1 cannot be used before initialization', name);
    }
    // 5. Else if the binding for N in envRec is a mutable binding, change its bound value to V.
    if (binding.mutable === true) {
      binding.value = value;
    } else {
      // a. Assert: This is an attempt to change the value of an immutable binding.
      // b. If S is true, throw a TypeError exception.
      if (strict) {
        return Throw.TypeError('Assignment to constant variable $1', name);
      }
    }
    // 7. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-getbindingvalue-n-s */
  * GetBindingValue(name: string, _strict: boolean): ValueEvaluator {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec has a binding for N.
    const binding = envRec.bindings.get(name);
    Assert(binding !== undefined);
    // 3. If the binding for N in envRec is an uninitialized binding, throw a ReferenceError exception.
    if (binding.initialized === false) {
      return Throw.ReferenceError('$1 cannot be used before initialization', name);
    }
    // 4. Return the value currently bound to N in envRec.
    return NormalCompletion(binding.value!);
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-deletebinding-n */
  * DeleteBinding(name: string): PlainEvaluator<boolean> {
    // 1. Let envRec be the declarative Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec has a binding for the name that is the value of N.
    const binding = envRec.bindings.get(name);
    Assert(binding !== undefined);
    // 3. If the binding for N in envRec cannot be deleted, return false.
    if (binding.deletable === false) {
      return false;
    }
    // 4. Remove the binding for N from envRec.
    envRec.bindings.delete(name);
    // 5. Return true.
    return true;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-hasthisbinding */
  HasThisBinding(): boolean {
    // 1. Return false.
    return false;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-hassuperbinding */
  HasSuperBinding(): boolean {
    // 1. Return false.
    return false;
  }

  /** https://tc39.es/ecma262/#sec-declarative-environment-records-withbaseobject */
  WithBaseObject() {
    // 1. Return undefined.
    return Value.undefined;
  }

  // NON-SPEC
  override mark(m: GCMarker) {
    super.mark(m);
    m(this.bindings);
    for (const resource of this.DisposableResourceStack) {
      m(resource.ResourceValue);
      m(resource.DisposeMethod);
    }
  }
}

/** https://tc39.es/ecma262/#sec-function-environment-records */
export class FunctionEnvironmentRecord extends DeclarativeEnvironmentRecord {
  /** https://tc39.es/ecma262/#sec-newfunctionenvironment */
  constructor(F: ECMAScriptFunctionObject, newTarget: UndefinedValue | ObjectValue) {
    // 1. Assert: F is an ECMAScript function.
    Assert(isECMAScriptFunctionObject(F));
    // 2. Assert: Type(newTarget) is Undefined or Object.
    Assert(newTarget instanceof UndefinedValue || newTarget instanceof ObjectValue);
    // 3. Let env be a new function Environment Record containing no bindings.
    super(F.Environment);
    // 4. Set env.[[FunctionObject]] to F.
    this.FunctionObject = F;
    // 5. If F.[[ThisMode]] is lexical, set env.[[ThisBindingStatus]] to lexical.

    if (F.ThisMode === 'lexical') {
      this.ThisBindingStatus = 'lexical';
    } else { // 6. Else, set env.[[ThisBindingStatus]] to uninitialized.
      this.ThisBindingStatus = 'uninitialized';
    }
    // 7. Set env.[[NewTarget]] to newTarget.
    this.NewTarget = newTarget;
    // 8. Set env.[[OuterEnv]] to F.[[Environment]].
    // 9. Return env.
  }

  protected ThisValue!: Value;

  ThisBindingStatus: 'lexical' | 'uninitialized' | 'initialized';

  readonly FunctionObject: ECMAScriptFunctionObject;

  readonly NewTarget: UndefinedValue | ObjectValue;

  /** https://tc39.es/ecma262/#sec-bindthisvalue */
  BindThisValue(V: Value) {
    // 1. Let envRec be the function Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec.[[ThisBindingStatus]] is not lexical.
    Assert(envRec.ThisBindingStatus !== 'lexical');
    // 3. If envRec.[[ThisBindingStatus]] is initialized, throw a ReferenceError exception.
    if (envRec.ThisBindingStatus === 'initialized') {
      return Throw.ReferenceError('this has already been initialized');
    }
    // 4. Set envRec.[[ThisValue]] to V.
    envRec.ThisValue = V;
    // 5. Set envRec.[[ThisBindingStatus]] to initialized.
    envRec.ThisBindingStatus = 'initialized';
    // 6. Return V.
    return V;
  }

  /** https://tc39.es/ecma262/#sec-function-environment-records-hasthisbinding */
  override HasThisBinding(): boolean {
    // 1. Let envRec be the function Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If envRec.[[ThisBindingStatus]] is lexical, return false; otherwise, return true.
    if (envRec.ThisBindingStatus === 'lexical') {
      return false;
    } else {
      return true;
    }
  }

  /** https://tc39.es/ecma262/#sec-function-environment-records-hassuperbinding */
  override HasSuperBinding(): boolean {
    const envRec = this;
    // 1. If envRec.[[ThisBindingStatus]] is lexical, return false.
    if (envRec.ThisBindingStatus === 'lexical') {
      return false;
    }
    // 2. If envRec.[[FunctionObject]].[[HomeObject]] has the value undefined, return false; otherwise, return true.
    if (envRec.FunctionObject.HomeObject === Value.undefined) {
      return false;
    } else {
      return true;
    }
  }

  /** https://tc39.es/ecma262/#sec-function-environment-records-getthisbinding */
  GetThisBinding() {
    // 1. Let envRec be the function Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec.[[ThisBindingStatus]] is not lexical.
    Assert(envRec.ThisBindingStatus !== 'lexical');
    // 3. If envRec.[[ThisBindingStatus]] is uninitialized, throw a ReferenceError exception.
    if (envRec.ThisBindingStatus === 'uninitialized') {
      return Throw.ReferenceError('this has not been initialized');
    }
    // 4. Return envRec.[[ThisValue]].
    return envRec.ThisValue;
  }

  /** https://tc39.es/ecma262/#sec-getsuperbase */
  GetSuperBase() {
    const envRec = this;
    // 1. Let home be envRec.[[FunctionObject]].[[HomeObject]].
    const home = envRec.FunctionObject.HomeObject;
    // 2. If home has the value undefined, return undefined.
    if (home === Value.undefined) {
      return Value.undefined;
    }
    // 3. Assert: Type(home) is Object.
    Assert(home instanceof ObjectValue);
    // 4. Return ! home.[[GetPrototypeOf]]().
    return X(home.GetPrototypeOf());
  }

  override mark(m: GCMarker) {
    super.mark(m);
    m(this.ThisValue);
    m(this.FunctionObject);
    m(this.NewTarget);
  }
}

/** https://tc39.es/ecma262/#sec-module-environment-records */
export class ModuleEnvironmentRecord extends DeclarativeEnvironmentRecord {
  declare readonly bindings: Map<string, ModuleEnvironmentBinding>;

  /** https://tc39.es/ecma262/#sec-module-environment-records-getbindingvalue-n-s */
  override* GetBindingValue(name: string, strict: boolean): ValueEvaluator {
    // 1. Assert: strict is true.
    Assert(strict);
    // 2. Let envRec be the module Environment Record for which the method was invoked.
    const envRec = this;
    // 3. Assert: envRec has a binding for N.
    const binding = envRec.bindings.get(name);
    Assert(binding !== undefined);
    // 4. If the binding for N is an indirect binding, then
    if (binding.indirect === true) {
      // a. Let M and N2 be the indirection values provided when this binding for N was created.
      const [module, targetName] = binding.target!;
      // b.Let targetEnv be M.[[Environment]].
      const targetEnv = module.Environment;
      // c. If targetEnv is undefined, throw a ReferenceError exception.
      if (!targetEnv) {
        return Throw.ReferenceError('$1 is not defined', name);
      }
      // d. Return ? targetEnv.GetBindingValue(N2, true).
      return yield* targetEnv.GetBindingValue(targetName, true);
    }
    // 5. If the binding for name is an uninitialized deferred initialization binding, initialize it.
    if (binding.initialized === false) {
      if (isDeferredInitializationBinding(binding)) {
        const value = binding.initializationSteps();
        yield* envRec.InitializeBinding(name, value);
      } else {
        return Throw.ReferenceError('$1 cannot be used before initialization', name);
      }
    }
    // 6. Return the value currently bound to name in envRec.
    return NormalCompletion(binding.value!);
  }

  /** https://tc39.es/ecma262/#sec-module-environment-records-deletebinding-n */
  override DeleteBinding(): never {
    Assert(false, 'This method is never invoked. See #sec-delete-operator-static-semantics-early-errors');
  }

  /** https://tc39.es/ecma262/#sec-module-environment-records-hasthisbinding */
  override HasThisBinding(): boolean {
    // Return true.
    return true;
  }

  /** https://tc39.es/ecma262/#sec-module-environment-records-getthisbinding */
  GetThisBinding() {
    // Return undefined.
    return Value.undefined;
  }

  /** https://tc39.es/ecma262/#sec-createimportbinding */
  CreateImportBinding(name: string, targetModule: AbstractModuleRecord, targetName: string) {
    // 1. Let envRec be the module Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec does not already have a binding for name.
    Assert(!X(envRec.HasBinding(name)));
    // 3. Assert: M is a Module Record.
    Assert(targetModule instanceof AbstractModuleRecord);
    // 4. Assert: When M.[[Environment]] is instantiated it will have a direct binding for N2.
    // 5. Create an immutable indirect binding in envRec for N that references M and N2 as its target binding and record that the binding is initialized.
    envRec.bindings.set(name, {
      indirect: true,
      target: [targetModule, targetName],
      initialized: true,
      mark(m: GCMarker) {
        m(this.target?.[0]);
        m(this.target?.[1]);
      },
    });
    // 6. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/proposal-deferred-reexports/#sec-createdeferredinitializationbinding */
  CreateDeferredInitializationBinding(name: string, initializationSteps: () => Value) {
    Assert(!X(this.HasBinding(name)));
    // 2. Create an immutable deferred initialization binding in envRec for name whose deferred initialization steps is initializationSteps, and record that the binding is uninitialized and that it is a strict binding.
    const binding: DeferredInitializationBinding = {
      indirect: false,
      initialized: false,
      mutable: false,
      strict: true,
      deletable: false,
      initializationSteps,
      mark(m) {
        m(this.value);
      },
    };
    this.bindings.set(name, binding);
  }
}

/** https://tc39.es/ecma262/#sec-object-environment-records */
export class ObjectEnvironmentRecord extends EnvironmentRecord {
  BindingObject: ObjectValue;

  IsWithEnvironment: boolean;

  /** https://tc39.es/ecma262/#sec-newobjectenvironment */
  constructor(object: ObjectValue, IsWithEnvironment: boolean, Environment: EnvironmentRecord | null) {
    super(Environment);
    this.BindingObject = object;
    this.IsWithEnvironment = IsWithEnvironment;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-hasbinding-n */
  * HasBinding(name: string): PlainEvaluator<boolean> {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Let foundBinding be ? HasProperty(bindings, N).
    const foundBinding = Q(yield* HasProperty(bindings, name));
    // 4. If foundBinding is false, return false.
    if (!foundBinding) {
      return false;
    }
    // 5. If the IsWithEnvironment flag of envRec i s false, return true.
    if (!envRec.IsWithEnvironment) {
      return true;
    }
    // 6. Let unscopables be ? Get(bindings, @@unscopables).
    const unscopables = Q(yield* Get(bindings, wellKnownSymbols.unscopables));
    // 7. If Type(unscopables) is Object, then
    if (unscopables instanceof ObjectValue) {
      // a. Let blocked be ! ToBoolean(? Get(unscopables, N)).
      const blocked = X(ToBoolean(Q(yield* Get(unscopables, name))));
      // b. If blocked is true, return false.
      if (blocked) {
        return false;
      }
    }
    // 8. Return true.
    return true;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-createmutablebinding-n-d */
  * CreateMutableBinding(name: string, deletable: boolean): PlainEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let envRec be the object Environment Record for which the method was invoked.
    const bindings = envRec.BindingObject;
    // 3. Return ? DefinePropertyOrThrow(bindings, name, PropertyDescriptor { [[Value]]: undefined, [[Writable]]: true, [[Enumerable]]: true, [[Configurable]]: D }).
    Q(yield* DefinePropertyOrThrow(bindings, name, Descriptor({
      Value: Value.undefined,
      Writable: true,
      Enumerable: true,
      Configurable: deletable,
    })));
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-createimmutablebinding-n-s */
  CreateImmutableBinding(_name: string, _strict: boolean) {
    Assert(false, 'CreateImmutableBinding called on an Object Environment Record');
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-initializebinding-n-v */
  * InitializeBinding(name: string, value: Value): PlainEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Assert: envRec must have an uninitialized binding for N.
    // 3. Record that the binding for N in envRec has been initialized.
    // 4. Return ? envRec.SetMutableBinding(N, V, false).
    Q(yield* envRec.SetMutableBinding(name, value, false));
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-setmutablebinding-n-v-s */
  * SetMutableBinding(name: string, value: Value, strict: boolean): PlainEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Let stillExists be ? HasProperty(bindings, N).
    const stillExists = Q(yield* HasProperty(bindings, name));
    // 4. If stillExists is false and S is true, throw a ReferenceError exception.
    if (!stillExists && strict) {
      return Throw.ReferenceError('$1 is not defined', name);
    }
    // 5. Return ? Set(bindings, name, value, strict).
    Q(yield* Set(bindings, name, value, strict));
    return undefined;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-getbindingvalue-n-s */
  * GetBindingValue(name: string, strict: boolean): ValueEvaluator {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Let value be ? HasProperty(bindings, name).
    const value = Q(yield* HasProperty(bindings, name));
    // 4. If value is false, then
    if (!value) {
      // a. If strict is false, return the value undefined; otherwise throw a ReferenceError exception.
      if (!strict) {
        return NormalCompletion(Value.undefined);
      } else {
        return Throw.ReferenceError('$1 is not defined', name);
      }
    }
    // 5. Return Get(bindings, name).
    return yield* Get(bindings, name);
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-deletebinding-n */
  * DeleteBinding(name: string): PlainEvaluator<boolean> {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let bindings be the binding object for envRec.
    const bindings = envRec.BindingObject;
    // 3. Return ? bindings.[[Delete]](N).
    return Q(yield* bindings.Delete(name));
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-hasthisbinding */
  HasThisBinding(): boolean {
    // 1. Return false.
    return false;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-hassuperbinding */
  HasSuperBinding(): boolean {
    // 1. Return false.
    return false;
  }

  /** https://tc39.es/ecma262/#sec-object-environment-records-withbaseobject */
  WithBaseObject() {
    // 1. Let envRec be the object Environment Record for which the method was invoked.
    const envRec = this;
    // 2. If the IsWithEnvironment flag of envRec is true, return the binding object for envRec.
    if (envRec.IsWithEnvironment) {
      return envRec.BindingObject;
    }
    // 3. Otherwise, return undefined.
    return Value.undefined;
  }

  // NON-SPEC
  override mark(m: GCMarker) {
    // TODO(ts): this function does not call super.mark(). is it a mistake?
    m(this.BindingObject);
  }
}

/** https://tc39.es/ecma262/#sec-global-environment-records */
export class GlobalEnvironmentRecord extends EnvironmentRecord {
  readonly ObjectRecord: ObjectEnvironmentRecord;

  readonly GlobalThisValue: ObjectValue;

  readonly DeclarativeRecord: DeclarativeEnvironmentRecord;

  /** https://tc39.es/ecma262/#sec-newglobalenvironment */
  constructor(G: ObjectValue, thisValue: ObjectValue) {
    // 1. Let objRec be NewObjectEnvironment(G, false, null).
    const objRec = new ObjectEnvironmentRecord(G, false, null);
    // 2. Let dclRec be a new declarative Environment Record containing no bindings.
    const dclRec = new DeclarativeEnvironmentRecord(null);
    // 3. Let env be a new global Environment Record.
    super(null);
    // 4. Set env.[[ObjectRecord]] to objRec.
    this.ObjectRecord = objRec;
    // 5. Set env.[[GlobalThisValue]] to thisValue.
    this.GlobalThisValue = thisValue;
    // 6. Set env.[[DeclarativeRecord]] to dclRec.
    this.DeclarativeRecord = dclRec;
    // 8. Set env.[[OuterEnv]] to null.
    // 9. Return env.
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-hasbinding-n */
  * HasBinding(name: string) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(name) is true, return true.
    if (yield* DclRec.HasBinding(name)) {
      return true;
    }
    // 4. If DclRec.HasBinding(name) is true, return true.
    const ObjRec = envRec.ObjectRecord;
    // 5. Let ObjRec be envRec.[[ObjectRecord]].
    return yield* ObjRec.HasBinding(name);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-createmutablebinding-n-d */
  * CreateMutableBinding(name: string, strict: boolean) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(name) is true, throw a TypeError exception.
    if (yield* DclRec.HasBinding(name)) {
      return Throw.TypeError('$1 is already declared', name);
    }
    // 4. Return DclRec.CreateMutableBinding(name, strict).
    return yield* DclRec.CreateMutableBinding(name, strict);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-createimmutablebinding-n-s */
  CreateImmutableBinding(name: string, strict: boolean) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(name) is true, throw a TypeError exception.
    if (X(DclRec.HasBinding(name))) {
      return Throw.TypeError('$1 is already declared', name);
    }
    // Return DclRec.CreateImmutableBinding(name, strict).
    return DclRec.CreateImmutableBinding(name, strict);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-initializebinding-n-v */
  * InitializeBinding(name: string, value: Value) {
    const envRec = this;
    const DclRec = envRec.DeclarativeRecord;
    if (X(DclRec.HasBinding(name))) {
      return X(DclRec.InitializeBinding(name, value));
    }
    // 4. Assert: If the binding exists, it must be in the object Environment Record.
    // 5. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 6. Return ? ObjRec.InitializeBinding(name, V).
    return yield* ObjRec.InitializeBinding(name, value);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-setmutablebinding-n-v-s */
  * SetMutableBinding(name: string, value: Value, strict: boolean): PlainEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(name) is true, then
    if (yield* DclRec.HasBinding(name)) {
      // a. Return DclRec.SetMutableBinding(name, value, strict).
      return yield* DclRec.SetMutableBinding(name, value, strict);
    }
    // 4. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 5. Return ? ObjRec.SetMutableBinding(name, value, strict).
    Q(yield* ObjRec.SetMutableBinding(name, value, strict));
    return undefined;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-getbindingvalue-n-s */
  * GetBindingValue(name: string, strict: boolean): ValueEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = envRec.DeclarativeRecord;
    // 3. If DclRec.HasBinding(name) is true, then
    if (yield* DclRec.HasBinding(name)) {
      // a. Return DclRec.GetBindingValue(name, strict).
      return yield* DclRec.GetBindingValue(name, strict);
    }
    // 4. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 5. Return ObjRec.GetBindingValue(name, strict).
    return yield* ObjRec.GetBindingValue(name, strict);
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-deletebinding-n */
  * DeleteBinding(name: string): PlainEvaluator<boolean> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let DclRec be envRec.[[DeclarativeRecord]].
    const DclRec = this.DeclarativeRecord;
    // 3. Let DclRec be envRec.[[DeclarativeRecord]].
    if (yield* DclRec.HasBinding(name)) {
      // a. Return DclRec.DeleteBinding(N).
      return Q(yield* DclRec.DeleteBinding(name));
    }
    // 4. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 5. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 6. Let existingProp be ? HasOwnProperty(globalObject, N).
    const existingProp = Q(yield* HasOwnProperty(globalObject, name));
    // 7. If existingProp is true, then
    if (existingProp) {
      // a. Return ? ObjRec.DeleteBinding(N).
      return Q(yield* ObjRec.DeleteBinding(name));
    }
    // 8. Return true.
    return true;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-hasthisbinding */
  HasThisBinding() {
    // Return true.
    return true;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-hassuperbinding */
  HasSuperBinding() {
    // 1. Return false.
    return false;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-withbaseobject */
  WithBaseObject() {
    // 1. Return undefined.
    return Value.undefined;
  }

  /** https://tc39.es/ecma262/#sec-global-environment-records-getthisbinding */
  GetThisBinding() {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Return envRec.[[GlobalThisValue]].
    return envRec.GlobalThisValue;
  }

  /** https://tc39.es/ecma262/#sec-haslexicaldeclaration */
  * HasLexicalDeclaration(name: string) {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let envRec be the global Environment Record for which the method was invoked.
    const DclRec = envRec.DeclarativeRecord;
    // 3. Let DclRec be envRec.[[DeclarativeRecord]].
    return yield* DclRec.HasBinding(name);
  }

  /** https://tc39.es/ecma262/#sec-hasrestrictedglobalproperty */
  * HasRestrictedGlobalProperty(name: string): PlainEvaluator<boolean> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let existingProp be ? globalObject.[[GetOwnProperty]](name).
    const existingProp = Q(yield* globalObject.GetOwnProperty(name));
    // 5. If existingProp is undefined, return false.
    if (!existingProp) {
      return false;
    }
    // 6. If existingProp.[[Configurable]] is true, return false.
    if (existingProp.Configurable) {
      return false;
    }
    // Return true.
    return true;
  }

  /** https://tc39.es/ecma262/#sec-candeclareglobalvar */
  * CanDeclareGlobalVar(N: string): PlainEvaluator<boolean> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let hasProperty be ? HasOwnProperty(globalObject, N).
    const hasProperty = Q(yield* HasOwnProperty(globalObject, N));
    // 5. If hasProperty is true, return true.
    if (hasProperty) {
      return true;
    }
    // 6. Return ? IsExtensible(globalObject).
    return Q(yield* IsExtensible(globalObject));
  }

  /** https://tc39.es/ecma262/#sec-candeclareglobalfunction */
  * CanDeclareGlobalFunction(N: string): PlainEvaluator<boolean> {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let existingProp be ? globalObject.[[GetOwnProperty]](N).
    const existingProp = Q(yield* globalObject.GetOwnProperty(N));
    // 5. If existingProp is undefined, return ? IsExtensible(globalObject).
    if (!existingProp) {
      return Q(yield* IsExtensible(globalObject));
    }
    // 6. If existingProp.[[Configurable]] is true, return true.
    if (existingProp.Configurable) {
      return true;
    }
    // 7. If IsDataDescriptor(existingProp) is true and existingProp has attribute values
    //    { [[Writable]]: true, [[Enumerable]]: true }, return true.
    if (IsDataDescriptor(existingProp) === true
      && existingProp.Writable
      && existingProp.Enumerable) {
      return true;
    }
    // 8. Return false.
    return false;
  }

  /** https://tc39.es/ecma262/#sec-createglobalvarbinding */
  * CreateGlobalVarBinding(name: string, deletable: boolean): PlainEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let hasProperty be ? HasOwnProperty(globalObject, N).
    const hasProperty = Q(yield* HasOwnProperty(globalObject, name));
    // 5. Let extensible be ? IsExtensible(globalObject).
    const extensible = Q(yield* IsExtensible(globalObject));
    // 6. If hasProperty is false and extensible is true, then
    if (!hasProperty && extensible) {
      // a. Perform ? ObjRec.CreateMutableBinding(N, D).
      Q(yield* ObjRec.CreateMutableBinding(name, deletable));
      // b. Perform ? ObjRec.InitializeBinding(N, undefined).
      Q(yield* ObjRec.InitializeBinding(name, Value.undefined));
    }
    // return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-createglobalfunctionbinding */
  * CreateGlobalFunctionBinding(name: string, value: FunctionObject, deletable: boolean): PlainEvaluator {
    // 1. Let envRec be the global Environment Record for which the method was invoked.
    const envRec = this;
    // 2. Let ObjRec be envRec.[[ObjectRecord]].
    const ObjRec = envRec.ObjectRecord;
    // 3. Let globalObject be the binding object for ObjRec.
    const globalObject = ObjRec.BindingObject;
    // 4. Let existingProp be ? globalObject.[[GetOwnProperty]](N).
    const existingProp = Q(yield* globalObject.GetOwnProperty(name));
    // 5. If existingProp is undefined or existingProp.[[Configurable]] is true, then
    let desc;
    if (!existingProp || existingProp.Configurable) {
      // a. Let desc be the PropertyDescriptor { [[Value]]: V, [[Writable]]: true, [[Enumerable]]: true, [[Configurable]]: D }.
      desc = Descriptor({
        Value: value,
        Writable: true,
        Enumerable: true,
        Configurable: deletable,
      });
    } else {
      // a. Let desc be the PropertyDescriptor { [[Value]]: V }.
      desc = Descriptor({
        Value: value,
      });
    }
    // 7. Perform ? DefinePropertyOrThrow(globalObject, N, desc).
    Q(yield* DefinePropertyOrThrow(globalObject, name, desc));
    // 8. Record that the binding for N in ObjRec has been initialized.
    // 9. Perform ? Set(globalObject, N, V, false).
    Q(yield* Set(globalObject, name, value, false));
    // 1. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  override mark(m: GCMarker) {
    // TODO(ts): this function does not call super.mark(). is it a mistake?
    m(this.ObjectRecord);
    m(this.GlobalThisValue);
    m(this.DeclarativeRecord);
  }
}

export type EnvironmentRecordWithThisBinding = FunctionEnvironmentRecord | GlobalEnvironmentRecord | ModuleEnvironmentRecord;

/** https://tc39.es/ecma262/#sec-getidentifierreference */
export function* GetIdentifierReference(env: EnvironmentRecord | null, name: string, strict: boolean): PlainEvaluator<ReferenceRecord> {
  // 1. If lex is the value null, then
  if (env === null) {
    // a. Return the Reference Record { [[Base]]: unresolvable, [[ReferencedName]]: name, [[Strict]]: strict, [[ThisValue]]: empty }.
    return NormalCompletion(new ReferenceRecord({
      Base: 'unresolvable',
      ReferencedName: Value(name),
      Strict: strict,
      ThisValue: undefined,
    }));
  }
  // 2. Let exists be ? envRec.HasBinding(name).
  const exists = Q(yield* env.HasBinding(name));
  // 3. If exists is true, then
  if (exists) {
    // a. Return the Reference Record { [[Base]]: env, [[ReferencedName]]: name, [[Strict]]: strict, [[ThisValue]]: empty }.
    return NormalCompletion(new ReferenceRecord({
      Base: env,
      ReferencedName: Value(name),
      Strict: strict,
      ThisValue: undefined,
    }));
  } else {
    // a. Let outer be env.[[OuterEnv]].
    const outer = env.OuterEnv;
    // b. Return ? GetIdentifierReference(outer, name, strict).
    return yield* GetIdentifierReference(outer, name, strict);
  }
}
