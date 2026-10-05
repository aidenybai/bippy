import { X, Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Evaluate_PropertyName } from './PropertyName.mts';
import {
  surroundingAgent,
  CreateBuiltinFunction, DefinePropertyOrThrow, MakeMethod, OrdinaryFunctionCreate, PrivateGet, PrivateSet, SymbolDescriptiveString,
} from '#self';
import {
  ClassElementDefinitionRecord,
  Descriptor,
  SymbolValue,
  Value,
  type Arguments,
  type ECMAScriptFunctionObject, type FunctionCallContext, type FunctionObject, type ObjectValue, PrivateName, type PropertyKeyValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-classfielddefinition-record-specification-type */
export interface ClassFieldDefinitionRecord {
  readonly Name: PropertyKeyValue | PrivateName;
  readonly Initializer: ECMAScriptFunctionObject | undefined;
}
export const ClassFieldDefinitionRecord = function ClassFieldDefinitionRecord(value: ClassFieldDefinitionRecord) {
  Object.setPrototypeOf(value, ClassFieldDefinitionRecord.prototype);
  return value;
} as {
  (value: ClassFieldDefinitionRecord): ClassFieldDefinitionRecord;
  [Symbol.hasInstance](instance: unknown): instance is ClassFieldDefinitionRecord;
};

export function* ClassFieldDefinitionEvaluation(FieldDefinition: ParseNode.FieldDefinition, homeObject: ObjectValue): PlainEvaluator<ClassFieldDefinitionRecord> {
  const { ClassElementName, Initializer } = FieldDefinition;
  // 1. Let name be the result of evaluating ClassElementName.
  const name = Q(yield* Evaluate_PropertyName(ClassElementName));
  // 3. If Initializer is present, then
  let initializer;
  if (Initializer) {
    // a. Let formalParameterList be an instance of the production FormalParameters : [empty].
    const formalParameterList: readonly [] = [];
    // b. Let scope be the LexicalEnvironment of the running execution context.
    const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    // c. Let privateScope be the running execution context's PrivateEnvironment.
    const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
    // d. Let sourceText be the empty sequence of Unicode code points.
    const sourceText = '';
    // e. Let initializer be ! OrdinaryFunctionCreate(%Function.prototype%, sourceText, formalParameterList, Initializer, non-lexical-this, scope, privateScope).
    initializer = X(OrdinaryFunctionCreate(
      surroundingAgent.intrinsic('%Function.prototype%'),
      sourceText,
      formalParameterList,
      Initializer,
      'non-lexical-this',
      scope,
      privateScope,
    ));
    // f. Perform MakeMethod(initializer, homeObject).
    MakeMethod(initializer, homeObject);
    // g. Set initializer.[[ClassFieldInitializerName]] to name.
    initializer.ClassFieldInitializerName = name;
  } else { // 4. Else,
    // a. Let initializer be empty.
    initializer = undefined;
  }
  // 5. Return the ClassFieldDefinition Record { [[Name]]: name, [[Initializer]]: initializer }.
  return ClassFieldDefinitionRecord({
    Name: name,
    Initializer: initializer,
  });
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-runtime-semantics-classfielddefinitionevaluation */
export function* ClassFieldDefinitionEvaluation_decorator(FieldDefinition: ParseNode.FieldDefinition, homeObject: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord> {
  const { ClassElementName, Initializer, accessor } = FieldDefinition;

  if (!accessor) {
    const name = Q(yield* Evaluate_PropertyName(ClassElementName));
    const initializers: FunctionObject[] = [];
    const extraInitializers: FunctionObject[] = [];
    if (Initializer) {
      const initializer = CreateFieldInitializerFunction(homeObject, name, Initializer);
      // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
      if (surroundingAgent.feature('decorators.no-bugfix.1')) {
        initializers.push(initializer);
      } else {
        initializers[-1] = initializer;
      }
    }
    return ClassElementDefinitionRecord({
      Kind: 'field',
      Key: name,
      Initializers: initializers,
      ExtraInitializers: extraInitializers,
      Decorators: undefined,
    });
  } else {
    const name = Q(yield* Evaluate_PropertyName(ClassElementName));
    let readableName: string;
    if (name instanceof PrivateName) {
      readableName = name.Description;
    } else if (name instanceof SymbolValue) {
      readableName = SymbolDescriptiveString(name);
    } else {
      readableName = name.stringValue();
    }
    const privateStateDesc = `${readableName} accessor storage`;
    const privateStateName = new PrivateName(privateStateDesc);
    const getter = MakeAutoAccessorGetter(homeObject, name, privateStateName);
    const setter = MakeAutoAccessorSetter(homeObject, name, privateStateName);
    const initializers = [];
    const extraInitializers: FunctionObject[] = [];
    if (Initializer) {
      const initializer = CreateFieldInitializerFunction(homeObject, name, Initializer);
      // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
      if (surroundingAgent.feature('decorators.no-bugfix.1')) {
        initializers.push(initializer);
      } else {
        initializers[-1] = initializer;
      }
    }
    if (!(name instanceof PrivateName)) {
      const desc = Descriptor({
        Get: getter,
        Set: setter,
        Enumerable: true,
        Configurable: true,
      });
      Q(yield* DefinePropertyOrThrow(homeObject, name, desc));
    }
    return ClassElementDefinitionRecord({
      Kind: 'accessor',
      Key: name,
      Get: getter,
      Set: setter,
      BackingStorageKey: privateStateName,
      Initializers: initializers,
      ExtraInitializers: extraInitializers,
      Decorators: undefined,
    });
  }
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createfieldinitializerfunction */
export function CreateFieldInitializerFunction(homeObject: ObjectValue, propName: PropertyKeyValue | PrivateName, Initializer: ParseNode.AssignmentExpressionOrHigher) {
  const formalParameterList: readonly [] = [];
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  const sourceText = '';
  const initializer = OrdinaryFunctionCreate(
    surroundingAgent.intrinsic('%Function.prototype%'),
    sourceText,
    formalParameterList,
    Initializer,
    'non-lexical-this',
    scope,
    privateScope,
  );
  MakeMethod(initializer, homeObject);
  initializer.ClassFieldInitializerName = propName;
  return initializer;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-makeautoaccessorgetter */
export function MakeAutoAccessorGetter(_homeObject: ObjectValue, _name: PropertyKeyValue | PrivateName, privateStateName: PrivateName) {
  const getterClosure = function* getterClosure(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    const o = thisValue as ObjectValue;
    return Q(yield* PrivateGet(o, privateStateName));
  };
  const getter = CreateBuiltinFunction(getterClosure, 0, Value('get'), []);
  // TODO(decorator): spec bug, SetFunctionName only accepts ECMAScriptFunctionObject, but the name is already set when calling CreateBuiltinFunction
  // SetFunctionName(getter, name, Value('get'));
  // TODO(decorator): https://github.com/tc39/proposal-decorators/issues/568
  // MakeMethod(getter, homeObject);
  return getter;
}

export function MakeAutoAccessorSetter(_homeObject: ObjectValue, _name: PropertyKeyValue | PrivateName, privateStateName: PrivateName) {
  const setterClosure = function* setterClosure([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    const o = thisValue as ObjectValue;
    Q(yield* PrivateSet(o, privateStateName, value));
    return Value.undefined;
  };
  const setter = CreateBuiltinFunction(setterClosure, 1, Value('set'), []);
  // TODO(decorator): spec bug
  // SetFunctionName(setter, name, Value('set'));
  // TODO(decorator): https://github.com/tc39/proposal-decorators/issues/568
  // MakeMethod(setter, homeObject);
  return setter;
}
