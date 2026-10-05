import {
  Value, NullValue, ObjectValue, PrivateName,
  type Arguments,
  type FunctionCallContext,
  UndefinedValue,
  type PropertyKeyValue,
  ReferenceRecord,
} from '../value.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import {
  IsStatic,
  ConstructorMethod,
  NonConstructorElements,
  PrivateBoundIdentifiers,
} from '../static-semantics/all.mts';
import {
  Q, X,
  AbruptCompletion,
} from '../completion.mts';
import { __ts_cast__, OutOfRange, type Mutable } from '../utils/language.mts';
import type { Location, ParseNode } from '../parser/ParseNode.mts';
import {
  DefineMethod,
  MethodDefinitionEvaluation,
  ClassFieldDefinitionEvaluation,
  PrivateElementRecord,
  ClassFieldDefinitionRecord,
  ClassStaticBlockDefinitionEvaluation,
  ClassStaticBlockDefinitionRecord,
  ClassFieldDefinitionEvaluation_decorator,
} from './all.mts';
import {
  surroundingAgent,
  DeclarativeEnvironmentRecord,
  PrivateEnvironmentRecord,

  CreateDataPropertyOrThrow, HasProperty, InitializeFieldOrAccessor, InitializePrivateMethods, IsPropertyKey, markBuiltinFunctionAsConstructor, PrivateElementFind, PrivateGet, PrivateSet, Set, Throw,
  type PlainCompletion,
} from '#self';
import {
  Assert,
  Call,
  Construct,
  CreateBuiltinFunction,
  Get,
  GetValue,
  IsConstructor,
  MakeConstructor,
  MakeClassConstructor,
  SetFunctionName,
  CreateMethodProperty,
  OrdinaryObjectCreate,
  OrdinaryCreateFromConstructor,
  PrivateMethodOrAccessorAdd,
  InitializeInstanceElements,
  DefineField,
  type ECMAScriptFunctionObject,
  type BuiltinFunctionObject,
  type FunctionObject,
  DefineMethodProperty,
  IsCallable,
  getActiveScriptId,
} from '#self';

/** https://tc39.es/ecma262/#sec-static-semantics-classelementevaluation */
// -decorator
function ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable: boolean): PlainEvaluator<PrivateElementRecord | ClassFieldDefinitionRecord | void>
// +decorator
function ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord | ClassStaticBlockDefinitionRecord | void>
function* ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable?: boolean): PlainEvaluator<ClassElementDefinitionRecord | ClassFieldDefinitionRecord | ClassStaticBlockDefinitionRecord | PrivateElementRecord | void> {
  switch (node.type) {
    case 'MethodDefinition':
    case 'GeneratorMethod':
    case 'AsyncMethod':
    case 'AsyncGeneratorMethod': {
      if (surroundingAgent.feature('decorators')) {
        const decorators = node.Decorators ? Q(yield* DecoratorListEvaluation(node.Decorators)) : [];
        const methodDefinition = Q(yield* MethodDefinitionEvaluation(node, object));
        methodDefinition.Decorators = decorators;
        return methodDefinition;
      } else {
        return yield* MethodDefinitionEvaluation(node, object, enumerable!);
      }
    }
    case 'FieldDefinition': {
      if (surroundingAgent.feature('decorators')) {
        const decorators = node.Decorators ? Q(yield* DecoratorListEvaluation(node.Decorators)) : [];
        const fieldDefinition = Q(yield* ClassFieldDefinitionEvaluation_decorator(node, object));
        fieldDefinition.Decorators = decorators;
        return fieldDefinition;
      } else {
        return yield* ClassFieldDefinitionEvaluation(node, object);
      }
    }
    case 'ClassStaticBlock':
      return ClassStaticBlockDefinitionEvaluation(node, object);
    default:
      throw OutOfRange.exhaustive(node);
  }
}

export interface DefaultConstructorBuiltinFunction extends BuiltinFunctionObject {
  // -decorator
  readonly PrivateMethods: ECMAScriptFunctionObject['PrivateMethods'];
  readonly Fields: ECMAScriptFunctionObject['Fields'];
  // +decorator (PrivateMethods => Initializers, Fields => Elements)
  readonly Initializers: ECMAScriptFunctionObject['Initializers'];
  readonly Elements: ECMAScriptFunctionObject['Elements'];
  readonly SourceText: ECMAScriptFunctionObject['SourceText'];
  readonly ConstructorKind: ECMAScriptFunctionObject['ConstructorKind'];
  /**
   * Note: this is different than InitialName, which is used and observable in Function.prototype.toString.
   * This is only used in the inspector.
  */
  readonly HostInitialName: PropertyKeyValue | PrivateName;
  readonly HostLocation: [scriptId: string | undefined, location: Location];
}

// ClassTail : ClassHeritage? `{` ClassBody? `}`
/** https://tc39.es/ecma262/#sec-runtime-semantics-classdefinitionevaluation */
/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-runtime-semantics-classdefinitionevaluation */
export function* ClassDefinitionEvaluation(ClassTail: ParseNode.ClassTail, classBinding: string | undefined, className: string | PropertyKeyValue | PrivateName, sourceText: string, decorators: readonly DecoratorDefinitionRecord[]): ValueEvaluator<FunctionObject> {
  const { ClassHeritage, ClassBody } = ClassTail;
  // 1. Let env be the LexicalEnvironment of the running execution context.
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 2. Let classScope be NewDeclarativeEnvironment(env).
  const classScope = new DeclarativeEnvironmentRecord(env);
  // 3. If classBinding is not undefined, then
  if (classBinding !== undefined) {
    // a. Perform classScopeEnv.CreateImmutableBinding(classBinding, true).
    classScope.CreateImmutableBinding(classBinding, true);
  }
  // 4. Let outerPrivateEnvironment be the running execution context's PrivateEnvironment.
  const outerPrivateEnvironment = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 5. Let classPrivateEnvironment be NewPrivateEnvironment(outerPrivateEnvironment).
  const classPrivateEnvironment = new PrivateEnvironmentRecord(outerPrivateEnvironment);
  // 6. If ClassBody is present, then
  if (ClassBody) {
    // a. For each String dn of the PrivateBoundIdentifiers of ClassBody, do
    for (const dn of PrivateBoundIdentifiers(ClassBody)) {
      // i. If classPrivateEnvironment.[[Names]] contains a Private Name whose [[Description]] is dn, then
      const existing = classPrivateEnvironment.Names.find((n) => n.Description === dn);
      if (existing) {
        // 1. Assert: This is only possible for getter/setter pairs.
      } else { // ii. Else,
        // 1. Let name be a new Private Name whose [[Description]] value is dn.
        const name = new PrivateName(dn);
        // 2. Append name to classPrivateEnvironment.[[Names]].
        classPrivateEnvironment.Names.push(name);
      }
    }
  }
  let protoParent;
  let constructorParent: ObjectValue;
  // 7. If ClassHeritage is not present, then
  if (!ClassHeritage) {
    // a. Let protoParent be %Object.prototype%.
    protoParent = surroundingAgent.intrinsic('%Object.prototype%');
    // b. Let constructorParent be %Function.prototype%.
    constructorParent = surroundingAgent.intrinsic('%Function.prototype%');
  } else { // 8. Else,
    // a. Set the running execution context's LexicalEnvironment to classScope.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = classScope;
    // b. Let superclassRef be the result of evaluating ClassHeritage.
    const superclassRef = Q(yield* Evaluate(ClassHeritage));
    // c. Set the running execution context's LexicalEnvironment to env.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
    // d. Let superclass be ? GetValue(superclassRef).
    const superclass = Q(yield* GetValue(superclassRef));
    // e. If superclass is null, then
    if (superclass instanceof NullValue) {
      // i. Let protoParent be null.
      protoParent = Value.null;
      // ii. Let constructorParent be %Function.prototype%.
      constructorParent = surroundingAgent.intrinsic('%Function.prototype%');
    } else if (!IsConstructor(superclass)) {
      // f. Else if IsConstructor(superclass) is false, throw a TypeError exception.
      return Throw.TypeError('Super class $1 is not a constructor', superclass);
    } else { // g. Else,
      // i. Let protoParent be ? Get(superclass, "prototype").
      protoParent = Q(yield* Get(superclass as ObjectValue, 'prototype'));
      // ii. If Type(protoParent) is neither Object nor Null, throw a TypeError exception.
      if (!(protoParent instanceof ObjectValue) && !(protoParent instanceof NullValue)) {
        return Throw.TypeError('Super class\'s prototype must be an object or null');
      }
      // iii. Let constructorParent be superclass.
      constructorParent = superclass as ObjectValue;
    }
  }
  // 9. Let proto be OrdinaryObjectCreate(protoParent).
  const proto = OrdinaryObjectCreate(protoParent);
  let constructor;
  // 10. If ClassBody is not present, let constructor be empty.
  if (!ClassBody) {
    constructor = undefined;
  } else { // 11. Else, let constructor be ConstructorMethod of ClassBody.
    constructor = ConstructorMethod(ClassBody);
  }
  // 12. Set the running execution context's LexicalEnvironment to classScope.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = classScope;
  // 13. Set the running execution context's PrivateEnvironment to classPrivateEnvironment.
  surroundingAgent.runningExecutionContext.PrivateEnvironment = classPrivateEnvironment;
  let F;
  // 14. If constructor is empty, then
  if (constructor === undefined) {
    // a. Let defaultConstructor be a new Abstract Closure with no parameters that captures nothing and performs the following steps when called:
    const defaultConstructor = function* defaultConstructor(args: Arguments, { NewTarget }: FunctionCallContext) {
      // i. Let args be the List of arguments that was passed to this function by [[Call]] or [[Construct]].
      // ii. If NewTarget is undefined, throw a TypeError exception.
      if (NewTarget instanceof UndefinedValue) {
        return Throw.TypeError('$1 cannot be invoked without new', surroundingAgent.activeFunctionObject);
      }
      // iii. Let F be the active function object.
      const F = surroundingAgent.activeFunctionObject as ECMAScriptFunctionObject; // eslint-disable-line no-shadow
      let result;
      // iv. If F.[[ConstructorKind]] is derived, then
      if (F.ConstructorKind === 'derived') {
        // 1. NOTE: This branch behaves similarly to `constructor(...args) { super(...args); }`. The most
        //    notable distinction is that while the aforementioned ECMAScript source text observably calls
        //    the @@iterator method on `%Array.prototype%`, a Default Constructor Function does not.
        // 2. Let func be ! F.[[GetPrototypeOf]]().
        const func = X(yield* F.GetPrototypeOf());
        // 3. If IsConstructor(func) is false, throw a TypeError exception.
        if (!IsConstructor(func)) {
          return Throw.TypeError('$1 is not a constructor', func);
        }
        // 4. Let result be ? Construct(func, args, NewTarget).
        result = Q(yield* Construct(func, args, NewTarget));
      } else { // v. Else,
        // 1. NOTE: This branch behaves similarly to `constructor() {}`.
        // 2. Let result be ? OrdinaryCreateFromConstructor(NewTarget, "%Object.prototype%").
        result = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Object.prototype%'));
      }
      Q(yield* InitializeInstanceElements(result, F));
      return result;
    };
    // b. ! CreateBuiltinFunction(defaultConstructor, 0, className, « [[ConstructorKind]], [[SourceText]], [[PrivateMethods]], [[Fields]] », the current Realm Record, constructorParent).
    F = X(CreateBuiltinFunction(markBuiltinFunctionAsConstructor(defaultConstructor), 0, className, ['ConstructorKind', 'SourceText', surroundingAgent.feature('decorators') ? 'Initializers' : 'PrivateMethods', surroundingAgent.feature('decorators') ? 'Elements' : 'Fields', 'HostLocation'], surroundingAgent.currentRealmRecord, constructorParent)) as Mutable<DefaultConstructorBuiltinFunction>;
    F.HostLocation = [getActiveScriptId(), ClassTail.location];
  } else { // 15. Else,
    // a. Let constructorInfo be ! DefineMethod of constructor with arguments proto and constructorParent.
    const constructorInfo = X(yield* DefineMethod(constructor, proto, constructorParent));
    // b. Let F be constructorInfo.[[Closure]].
    F = constructorInfo.Closure;
    // c. Perform SetFunctionName(F, className).
    SetFunctionName(F, className);
  }
  __ts_cast__<Mutable<DefaultConstructorBuiltinFunction>>(F);
  F.HostInitialName = typeof className === 'string' ? Value(className) : className;
  F.SourceText = sourceText;
  // 16. Perform MakeConstructor(F, false, proto).
  MakeConstructor(F, false, proto);
  // https://github.com/tc39/ecma262/pull/3212/
  // 17. Perform MakeClassConstructor(F).
  MakeClassConstructor(F);
  // 18. If ClassHeritage is present, set F.[[ConstructorKind]] to derived.
  if (ClassHeritage) {
    F.ConstructorKind = 'derived';
  }
  // 19. Perform CreateMethodProperty(proto, "constructor", F).
  X(CreateMethodProperty(proto, 'constructor', F));
  // 20. If ClassBody is not present, let elements be a new empty List.
  let elements: ParseNode.ClassElement[];
  if (!ClassBody) {
    elements = [];
  } else { // 20. Else, let elements be NonConstructorElements of ClassBody.
    elements = NonConstructorElements(ClassBody);
  }
  if (surroundingAgent.feature('decorators')) {
    const instanceElements: ClassElementDefinitionRecord[] = [];
    // 24. Let staticElements be a new empty List.
    const staticElements: (ClassElementDefinitionRecord | ClassStaticBlockDefinitionRecord)[] = [];
    // 25. For each ClassElement e of elements, do
    for (const e of elements) {
      let result;
      // a. If IsStatic of e is false, then
      if (!IsStatic(e)) {
        result = yield* ClassElementEvaluation(e, proto);
      } else {
        result = yield* ClassElementEvaluation(e, F);
      }
      // c. If field is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // i. Set the running execution context's LexicalEnvironment to env.
        surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
        // ii. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        return result;
      }
      const element = X(result);
      if (element instanceof ClassElementDefinitionRecord) {
        if (!IsStatic(e)) {
          instanceElements.push(element);
        } else {
          staticElements.push(element);
        }
      } else {
        Assert(element instanceof ClassStaticBlockDefinitionRecord);
        staticElements.push(element);
      }
    }
    // 26. Set the running execution context's LexicalEnvironment to env.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
    const instanceMethodExtraInitializers: FunctionObject[] = [];
    const staticMethodExtraInitializers: FunctionObject[] = [];
    for (const e of staticElements) {
      if (e instanceof ClassElementDefinitionRecord && e.Kind !== 'field') {
        let extraInitializers: FunctionObject[];
        if (e.Kind === 'accessor') {
          extraInitializers = e.ExtraInitializers;
        } else {
          extraInitializers = staticMethodExtraInitializers;
        }
        const result = yield* ApplyDecoratorsAndDefineMethod(F, e, extraInitializers, true);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    for (const e of instanceElements) {
      let extraInitializers: FunctionObject[];
      if (e.Kind !== 'field') {
        if (e.Kind === 'accessor') {
          extraInitializers = e.ExtraInitializers;
        } else {
          extraInitializers = instanceMethodExtraInitializers;
        }
        const result = yield* ApplyDecoratorsAndDefineMethod(proto, e, extraInitializers, false);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    for (const e of staticElements) {
      if (e instanceof ClassElementDefinitionRecord && e.Kind === 'field') {
        const result = yield* ApplyDecoratorsToElementDefinition(F, e, e.ExtraInitializers, true);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    for (const e of instanceElements) {
      if (e.Kind === 'field') {
        const result = yield* ApplyDecoratorsToElementDefinition(proto, e, e.ExtraInitializers, false);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    F.Elements = instanceElements;
    F.Initializers = instanceMethodExtraInitializers;
    // TODO(decorator): spec bug?
    // Q(yield* InitializePrivateMethods(F, staticElements));
    Q(yield* InitializePrivateMethods(F, staticElements.filter((element): element is ClassElementDefinitionRecord => element instanceof ClassElementDefinitionRecord)));
    const classExtraInitializers: FunctionObject[] = [];
    const newF = yield* ApplyDecoratorsToClassDefinition(F, decorators, className, classExtraInitializers);
    if (newF instanceof AbruptCompletion) {
      surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
      return newF;
    }
    F = Q(newF);
    // 27. If classBinding is not undefined, then
    if (classBinding !== undefined) {
      // a. Perform classScope.InitializeBinding(classBinding, F).
      yield* classScope.InitializeBinding(classBinding, F);
    }
    for (const initializer of staticMethodExtraInitializers) {
      const result = yield* Call(initializer, F);
      if (result instanceof AbruptCompletion) {
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        return result;
      }
    }
    // 31. For each element elementRecord of staticElements, do
    for (const elementRecord of staticElements) {
      let result;
      // a. If elementRecord is a ClassFieldDefinition Record, then
      if (elementRecord instanceof ClassElementDefinitionRecord && (elementRecord.Kind === 'field' || elementRecord.Kind === 'accessor')) {
        // a. Let result be DefineField(F, elementRecord).
        result = yield* InitializeFieldOrAccessor(F, elementRecord);
      } else if (elementRecord instanceof ClassStaticBlockDefinitionRecord) {
        result = yield* Call(elementRecord.BodyFunction, F);
      }
      // c. If result is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // i. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        // ii. Return result.
        return result;
      }
    }
    for (const initializer of classExtraInitializers) {
      const result = yield* Call(initializer, F);
      if (result instanceof AbruptCompletion) {
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        return result;
      }
    }
    // 32. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
    surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
    // 33. Return F.
    return F;
  } else {
    // 21. Let instancePrivateMethods be a new empty List.
    const instancePrivateMethods: never[] = [];
    // 22. Let staticPrivateMethods be a new empty List.
    const staticPrivateMethods: never[] = [];
    // 23. Let instanceFields be a new empty List.
    const instanceFields: ClassFieldDefinitionRecord[] = [];
    // 24. Let staticElements be a new empty List.
    const staticElements: (ClassFieldDefinitionRecord | ClassStaticBlockDefinitionRecord)[] = [];
    // 25. For each ClassElement e of elements, do
    for (const e of elements) {
      let _field: PlainCompletion<ClassFieldDefinitionRecord | PrivateElementRecord | ClassStaticBlockDefinitionRecord | void>;
      // a. If IsStatic of e is false, then
      if (IsStatic(e) === false) {
        // i. Let field be ClassElementEvaluation of e with arguments proto and false.
        _field = (yield* ClassElementEvaluation(e, proto, false))!;
      } else { // b. Else,
        // i. Let field be ClassElementEvaluation of e with arguments F and false.
        _field = (yield* ClassElementEvaluation(e, F, false))!;
      }
      // c. If field is an abrupt completion, then
      if (_field instanceof AbruptCompletion) {
        // i. Set the running execution context's LexicalEnvironment to env.
        surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
        // ii. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        // iii. Return Completion(field).
        return _field;
      }
      // d. Set field to field.[[Value]].
      const field = Q(_field);
      // e. If field is a PrivateElement, then
      if (field instanceof PrivateElementRecord) {
        // i. Assert: field.[[Kind]] is either method or accessor.
        Assert(field.Kind === 'method' || field.Kind === 'accessor');
        // ii. If IsStatic of e is false, let container be instancePrivateMethods.
        let container: PrivateElementRecord[];
        if (IsStatic(e) === false) {
          container = instancePrivateMethods;
        } else { // iii. Else, let container be staticPrivateMethods.
          container = staticPrivateMethods;
        }
        // iv. If container contains a PrivateElement whose [[Key]] is field.[[Key]], then
        const index = container.findIndex((el) => el.Key === field.Key);
        if (index >= 0) {
          // 1. Let existing be that PrivateElement.
          const existing = container[index];
          // 2. Assert: field.[[Kind]] and existing.[[Kind]] are both accessor.
          Assert(field.Kind === 'accessor' && existing.Kind === 'accessor');
          // 3. If field.[[Get]] is undefined, then
          let combined;
          if (field.Get === Value.undefined) {
            combined = PrivateElementRecord({
              Key: field.Key,
              Kind: 'accessor',
              Get: existing.Get,
              Set: field.Set,
            });
          } else { // 4. Else
            combined = PrivateElementRecord({
              Key: field.Key,
              Kind: 'accessor',
              Get: field.Get,
              Set: existing.Set,
            });
          }
          // 5. Replace existing in container with combined.
          container[index] = combined;
        } else { // v. Else,
          // 1. Append field to container.
          container.push(field);
        }
      } else if (field instanceof ClassFieldDefinitionRecord) { // f. Else if field is a ClassFieldDefinition Record, then
        // i. If IsStatic of e is false, append field to instanceFields.
        if (IsStatic(e) === false) {
          instanceFields.push(field);
        } else { // ii. Else, append field to staticElements.
          staticElements.push(field);
        }
      } else if (field && field instanceof ClassStaticBlockDefinitionRecord) { // g. Else if element is a ClassStaticBlockDefinition Record, then
        // i. Append element to staticElements.
        staticElements.push(field);
      } else {
        // h. Else, assert: field is empty.
        Assert(field === undefined);
      }
    }
    // 26. Set the running execution context's LexicalEnvironment to env.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
    // 27. If classBinding is not undefined, then
    if (classBinding !== undefined) {
      // a. Perform classScope.InitializeBinding(classBinding, F).
      yield* classScope.InitializeBinding(classBinding, F);
    }
    // 28. Set F.[[PrivateMethods]] to instancePrivateMethods.
    F.PrivateMethods = instancePrivateMethods;
    // 29. Set F.[[Fields]] to instanceFields.
    F.Fields = instanceFields;
    // 30. For each PrivateElement method of staticPrivateMethods, do
    for (const method of staticPrivateMethods) {
      // a. Perform ! PrivateMethodOrAccessorAdd(F, method).
      Q(yield* PrivateMethodOrAccessorAdd(F, method));
    }
    // 31. For each element elementRecord of staticElements, do
    for (const elementRecord of staticElements) {
      let result;
      // a. If elementRecord is a ClassFieldDefinition Record, then
      if (elementRecord instanceof ClassFieldDefinitionRecord) {
        // a. Let result be DefineField(F, elementRecord).
        result = yield* DefineField(F, elementRecord);
      } else { // b. Else,
        // i. Assert: elementRecord is a ClassStaticBlockDefinition Record.
        Assert(elementRecord instanceof ClassStaticBlockDefinitionRecord);
        // ii. Let result be Completion(Call(elementRecord.[[BodyFunction]], F)).
        result = yield* Call(elementRecord.BodyFunction, F);
      }
      // c. If result is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // i. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        // ii. Return result.
        return result;
      }
    }
    // 32. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
    surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
    // 33. Return F.
    return F;
  }
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-decoratorevaluation */
export function* DecoratorEvaluation(decorator: ParseNode.Decorator): PlainEvaluator<DecoratorDefinitionRecord> {
  const expr = decorator.MemberExpression || decorator.CallExpression || decorator.ParenthesizedExpression;
  const ref = Q(yield* Evaluate(expr));
  const value = Q(yield* GetValue(ref));
  return { Decorator: value, Receiver: ref };
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-decoratorelistvaluation */
export function* DecoratorListEvaluation(decoratorList: readonly ParseNode.Decorator[]): PlainEvaluator<DecoratorDefinitionRecord[]> {
  const decorators: DecoratorDefinitionRecord[] = [];
  for (const decoratorNode of decoratorList) {
    const decoratorRecord = Q(yield* DecoratorEvaluation(decoratorNode));
    decorators.unshift(decoratorRecord);
  }
  return decorators;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createdecoratoraccessobject */
export function CreateDecoratorAccessObject(kind: ClassElementDefinitionRecord['Kind'], name: string | PropertyKeyValue | PrivateName): ObjectValue {
  const accessObj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  if (kind === 'field' || kind === 'method' || kind === 'accessor' || kind === 'getter') {
    const getterClosure = function* getter([obj = Value.undefined]: Arguments) {
      if (!(obj instanceof ObjectValue)) {
        return Throw.TypeError('Invalid receiver');
      }
      if (IsPropertyKey(name) || typeof name === 'string') {
        return Q(yield* Get(obj, name));
      } else {
        return Q(yield* PrivateGet(obj, name));
      }
    };
    const getter = CreateBuiltinFunction(getterClosure, 1, Value(''), []);
    X(CreateDataPropertyOrThrow(accessObj, 'get', getter));
  }
  if (kind === 'field' || kind === 'accessor' || kind === 'setter') {
    const setterClosure = function* setter([obj = Value.undefined, value = Value.undefined]: Arguments): ValueEvaluator {
      if (!(obj instanceof ObjectValue)) {
        return Throw.TypeError('Invalid receiver');
      }
      if (IsPropertyKey(name) || typeof name === 'string') {
        return Value(Q(yield* Set(obj, name, value, true)));
      } else {
        return Value(Q(yield* PrivateSet(obj, name, value)));
      }
    };
    const setter = CreateBuiltinFunction(setterClosure, 2, Value(''), []);
    X(CreateDataPropertyOrThrow(accessObj, 'set', setter));
  }
  const hasClosure = function* has(this: Value, [obj = Value.undefined]: Arguments): ValueEvaluator {
    if (!(obj instanceof ObjectValue)) {
      return Throw.TypeError('Invalid receiver');
    }
    if (IsPropertyKey(name) || typeof name === 'string') {
      return Value(Q(yield* HasProperty(obj, name)));
    }
    if (PrivateElementFind(name, obj)) {
      return Value.true;
    }
    return Value.false;
  };
  const has = CreateBuiltinFunction(hasClosure, 1, Value('has'), []);
  X(CreateDataPropertyOrThrow(accessObj, 'has', has));
  return accessObj;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createaddinitializerfunction */
// TODO(decorator): spec bug, initializers should not require ECMAScriptFunctionObject
export function CreateAddInitializerFunction(initializers: FunctionObject[], decorationState: { Finished: boolean }): FunctionObject {
  const addInitializerClosure = function* addInitializer(this: Value, [initializer = Value.undefined]: Arguments) {
    if (decorationState.Finished) {
      return Throw.TypeError('Cannot call addInitializer after decoration is finished');
    }
    if (!IsCallable(initializer)) {
      return Throw.TypeError('addInitializer must be called with a function, but $1 was passed', initializer);
    }
    initializers.push(initializer);
    return Value.undefined;
  };
  return CreateBuiltinFunction(addInitializerClosure, 1, Value('addInitializer'), []);
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createdecoratorcontextobject */
export function CreateDecoratorContextObject(kind: 'class' | ClassElementDefinitionRecord['Kind'], name: string | PropertyKeyValue | PrivateName, initializers: FunctionObject[], decorationState: { Finished: boolean }, isStatic?: boolean): ObjectValue {
  const contextObj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  const kindStr = Value(kind);
  X(CreateDataPropertyOrThrow(contextObj, 'kind', kindStr));
  if (kind !== 'class') {
    X(CreateDataPropertyOrThrow(contextObj, 'access', CreateDecoratorAccessObject(kind, name)));
    if (isStatic !== undefined) {
      X(CreateDataPropertyOrThrow(contextObj, 'static', Value(isStatic)));
    }
    if (name instanceof PrivateName) {
      X(CreateDataPropertyOrThrow(contextObj, 'private', Value.true));
      X(CreateDataPropertyOrThrow(contextObj, 'name', Value(name.Description)));
    } else {
      X(CreateDataPropertyOrThrow(contextObj, 'private', Value.false));
      X(CreateDataPropertyOrThrow(contextObj, 'name', typeof name === 'string' ? Value(name) : name));
    }
  } else {
    // TODO(decorator): spec bug, no assert to the name
    X(CreateDataPropertyOrThrow(contextObj, 'name', name as PropertyKeyValue));
  }
  const addInitializer = CreateAddInitializerFunction(initializers, decorationState);
  X(CreateDataPropertyOrThrow(contextObj, 'addInitializer', addInitializer));
  return contextObj;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-applydecoratorstoelementdefinition */
// TODO(decorator): unused parameter in the spec
export function* ApplyDecoratorsToElementDefinition(_homeObject: ObjectValue, elementRecord: ClassElementDefinitionRecord, extraInitializers: FunctionObject[], isStatic: boolean): PlainEvaluator<void> {
  const decorators = elementRecord.Decorators;
  if (!decorators || decorators.length === 0) {
    return undefined;
  }
  const key = elementRecord.Key;
  const kind = elementRecord.Kind;
  for (const decoratorRecord of decorators) {
    const decorator = decoratorRecord.Decorator;
    const decoratorReceiver = decoratorRecord.Receiver;
    const decorationState = { Finished: false };
    const context = CreateDecoratorContextObject(kind, key, extraInitializers, decorationState, isStatic);
    let value: Value = Value.undefined;
    if (kind === 'method') {
      value = elementRecord.Value;
    } else if (kind === 'getter') {
      value = elementRecord.Get;
    } else if (kind === 'setter') {
      value = elementRecord.Set;
    } else if (kind === 'accessor') {
      value = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
      X(CreateDataPropertyOrThrow(value, 'get', elementRecord.Get));
      X(CreateDataPropertyOrThrow(value, 'set', elementRecord.Set));
    }
    // TODO(decorator): spec bug, missing GetValue call
    // const newValue = Q(yield* Call(decorator, decoratorReceiver), [value, context]));
    const newValue = Q(yield* Call(decorator, Q(yield* GetValue(decoratorReceiver)), [value, context]));
    decorationState.Finished = true;
    if (kind === 'field') {
      if (IsCallable(newValue)) {
        // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
        elementRecord.Initializers.unshift(newValue);
      } else if (newValue !== Value.undefined) {
        return Throw.TypeError('Field decorator must return a function or undefined, but $1 was returned', newValue);
      }
    } else if (kind === 'accessor') {
      if (newValue instanceof ObjectValue) {
      const newGetter = Q(yield* Get(newValue, 'get'));
        if (IsCallable(newGetter)) {
          elementRecord.Get = newGetter;
        } else if (newGetter !== Value.undefined) {
          return Throw.TypeError('The get property of the return value of an accessor decorator must be a function or undefined, but $1 was returned', newGetter);
        }
      const newSetter = Q(yield* Get(newValue, 'set'));
        if (IsCallable(newSetter)) {
          elementRecord.Set = newSetter;
        } else if (newSetter !== Value.undefined) {
          return Throw.TypeError('The set property of the return value of an accessor decorator must be a function or undefined, but $1 was returned', newSetter);
        }
      const initializer = Q(yield* Get(newValue, 'init'));
        if (IsCallable(initializer)) {
          // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
          elementRecord.Initializers.unshift(initializer);
        } else if (initializer !== Value.undefined) {
          return Throw.TypeError('The init property of the return value of an accessor decorator must be a function or undefined, but $1 was returned', initializer);
        }
      } else if (newValue !== Value.undefined) {
        return Throw.TypeError('Accessor decorator must return an object or undefined, but $1 was returned', newValue);
      }
    } else {
      if (IsCallable(newValue)) {
        if (kind === 'getter') {
          elementRecord.Get = newValue;
        } else if (kind === 'setter') {
          elementRecord.Set = newValue;
        } else {
          elementRecord.Value = newValue;
        }
      } else if (newValue !== Value.undefined) {
        return Throw.TypeError('Method decorator must return a function or undefined, but $1 was returned', newValue);
      }
    }
  }
  elementRecord.Decorators = undefined;
  return undefined;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-applydecoratorstoclassdefinition */
export function* ApplyDecoratorsToClassDefinition(classDef: FunctionObject, decorators: readonly DecoratorDefinitionRecord[], className: string | PropertyKeyValue | PrivateName, extraInitializers: FunctionObject[]): PlainEvaluator<FunctionObject> {
  for (const decoratorRecord of decorators) {
    const decorator = decoratorRecord.Decorator;
    const decoratorReceiver = decoratorRecord.Receiver;
    const decorationState = { Finished: false };
    const context = CreateDecoratorContextObject('class', className, extraInitializers, decorationState);
    // TODO(decorator): spec bug, missing GetValue call
    // const newDef = Q(yield* Call(decorator, decoratorReceiver, [classDef, context]));
    const newDef = Q(yield* Call(decorator, Q(yield* GetValue(decoratorReceiver)), [classDef, context]));
    decorationState.Finished = true;
    if (IsCallable(newDef)) {
      classDef = newDef;
    } else if (newDef !== Value.undefined) {
      return Throw.TypeError('Class decorator must return a function or undefined, but $1 was returned', newDef);
    }
  }
  return classDef;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-applydecoratorsanddefinemethod */
export function* ApplyDecoratorsAndDefineMethod(homeObject: ObjectValue, methodDefinition: ClassElementDefinitionRecord, extraInitializers: FunctionObject[], isStatic: boolean): PlainEvaluator<void> {
  Q(yield* ApplyDecoratorsToElementDefinition(homeObject, methodDefinition, extraInitializers, isStatic));
  // TODO(decorator): spec bug, enumerable of class methods, whether decorated or not, should always be false
  // Q(yield* DefineMethodProperty(homeObject, methodDefinition, isStatic));
  Q(yield* DefineMethodProperty(homeObject, methodDefinition, false));
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-decoratordefinition-record-specification-type */
export interface DecoratorDefinitionRecord {
  readonly Decorator: Value;
  readonly Receiver: ReferenceRecord | Value;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-classfielddefinition-record-specification-type */
export type ClassElementDefinitionRecord = ClassElementDefinitionRecord_Method | ClassElementDefinitionRecord_Field | ClassElementDefinitionRecord_Accessor | ClassElementDefinitionRecord_Getter | ClassElementDefinitionRecord_Setter;
export interface ClassElementDefinitionRecord_Method {
  readonly Kind: 'method';
  readonly Key: PrivateName | PropertyKeyValue;
  // TODO(decorator): spec bug, spec is ECMAScriptFunctionObject
  Value: FunctionObject;
  Decorators: DecoratorDefinitionRecord[] | undefined;
}
export interface ClassElementDefinitionRecord_Field {
  readonly Kind: 'field';
  readonly Key: PrivateName | PropertyKeyValue;
  Decorators: DecoratorDefinitionRecord[] | undefined;
  readonly Initializers: FunctionObject[];
  readonly ExtraInitializers: FunctionObject[];
}
export interface ClassElementDefinitionRecord_Accessor {
  readonly Kind: 'accessor';
  readonly Key: PrivateName | PropertyKeyValue;
  // https://github.com/tc39/proposal-decorators/issues/572
  Get: FunctionObject;
  // https://github.com/tc39/proposal-decorators/issues/572
  Set: FunctionObject;
  readonly BackingStorageKey: PrivateName;
  Decorators: readonly DecoratorDefinitionRecord[] | undefined;
  readonly Initializers: FunctionObject[];
  readonly ExtraInitializers: FunctionObject[];
}
export interface ClassElementDefinitionRecord_Getter {
  readonly Kind: 'getter';
  readonly Key: PrivateName | PropertyKeyValue;
  // https://github.com/tc39/proposal-decorators/issues/572
  Get: FunctionObject;
  Decorators: readonly DecoratorDefinitionRecord[] | undefined;
}
export interface ClassElementDefinitionRecord_Setter {
  readonly Kind: 'setter';
  readonly Key: PrivateName | PropertyKeyValue;
  // https://github.com/tc39/proposal-decorators/issues/572
  Set: FunctionObject;
  Decorators: readonly DecoratorDefinitionRecord[] | undefined;
}

// This is a struct defined as a marco.
export const ClassElementDefinitionRecord = (function ClassElementDefinitionRecord(record: ClassElementDefinitionRecord) {
  Object.setPrototypeOf(record, ClassElementDefinitionRecord.prototype);
  return record;
}) as {
  (record: ClassElementDefinitionRecord): ClassElementDefinitionRecord;
  [Symbol.hasInstance](instance: unknown): instance is ClassElementDefinitionRecord;
};
