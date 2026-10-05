import {
  Value, Descriptor, PrivateName, UndefinedValue, type PropertyKeyValue, ObjectValue,
} from '../value.mts';
import {
  Q, X,
} from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { ClassElementDefinitionRecord, DefineMethod, Evaluate_PropertyName } from './all.mts';
import { surroundingAgent } from '#self';
import {
  OrdinaryObjectCreate,
  OrdinaryFunctionCreate,
  DefinePropertyOrThrow,
  SetFunctionName,
  MakeMethod,
  sourceTextMatchedBy,
  type FunctionObject,
  type GCMarker,
} from '#self';

/** https://tc39.es/ecma262/#sec-privateelement-specification-type */
export interface PrivateElementRecord_Value {
  readonly Key: PrivateName;
  readonly Kind: 'method' | 'field';
  Value?: Value;
  readonly Get?: undefined;
  readonly Set?: undefined;
}
export interface PrivateElementRecord_Accessor {
  readonly Key: PrivateName;
  readonly Kind: 'accessor';
  Value?: Value;
  readonly Get?: FunctionObject | UndefinedValue;
  readonly Set?: FunctionObject | UndefinedValue;
}
export type PrivateElementRecord = PrivateElementRecord_Value | PrivateElementRecord_Accessor;
export const PrivateElementRecord = function PrivateElementRecord(value: PrivateElementRecord) {
  Object.setPrototypeOf(value, PrivateElementRecord.prototype);
  return value;
} as {
  (value: PrivateElementRecord): PrivateElementRecord;
  [Symbol.hasInstance](instance: unknown): instance is PrivateElementRecord;
};

// NON-SPEC
PrivateElementRecord.prototype.mark = function mark(m: GCMarker): void {
  m(this.Value);
  m(this.Get);
  m(this.Set);
};

// -decorator
// +decorator: remove this function
/** https://tc39.es/ecma262/#sec-definemethodproperty */
function* DefineMethodProperty(key: PropertyKeyValue | PrivateName, homeObject: ObjectValue, closure: FunctionObject, enumerable: boolean): PlainEvaluator<PrivateElementRecord | undefined> {
  // 1. If key is a Private Name, then
  if (key instanceof PrivateName) {
    // a. Return PrivateElement { [[Key]]: key, [[Kind]]: method, [[Value]]: closure }.
    return PrivateElementRecord({
      Key: key,
      Kind: 'method',
      Value: closure,
    });
  } else { // 2. Else,
    // a. Let desc be the PropertyDescriptor { [[Value]]: closure, [[Writable]]: true, [[Enumerable]]: enumerable, [[Configurable]]: true }.
    const desc = Descriptor({
      Value: closure,
      Writable: true,
      Enumerable: enumerable,
      Configurable: true,
    });
    // b. Perform ? DefinePropertyOrThrow(homeObject, key, desc).
    Q(yield* DefinePropertyOrThrow(homeObject, key, desc));
    // c. Return empty.
    return undefined;
  }
}

// MethodDefinition :
//   ClassElementName `(` UniqueFormalParameters `)` `{` FunctionBody `}`
//   `get` ClassElementName `(` `)` `{` FunctionBody `}`
//   `set` ClassElementName `(` PropertySetParameterList `)` `{` FunctionBody `}`
// -decorator signature
function MethodDefinitionEvaluation_MethodDefinition(MethodDefinition: ParseNode.MethodDefinition, object: ObjectValue, enumerable: boolean): PlainEvaluator<ClassElementDefinitionRecord>
// +decorator signature
function MethodDefinitionEvaluation_MethodDefinition(MethodDefinition: ParseNode.MethodDefinition, object: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord>
function* MethodDefinitionEvaluation_MethodDefinition(MethodDefinition: ParseNode.MethodDefinition, object: ObjectValue, enumerable?: boolean): PlainEvaluator<ClassElementDefinitionRecord | PrivateElementRecord | void> {
  switch (true) {
    case !!MethodDefinition.UniqueFormalParameters: {
      // 1. Let methodDef be ? DefineMethod of MethodDefinition with argument object.
      const methodDef = Q(yield* DefineMethod(MethodDefinition, object));
      // 2. Perform ! SetFunctionName(methodDef.[[Closure]], methodDef.[[Key]]).
      X(SetFunctionName(methodDef.Closure, methodDef.Key));
      // 3. Return ? DefineMethodProperty(methodDef.[[Key]], object, methodDef.[[Closure]], enumerable).
      if (enumerable !== undefined) {
        return Q(yield* DefineMethodProperty(methodDef.Key, object, methodDef.Closure, enumerable));
      } else {
        return ClassElementDefinitionRecord({
          Key: methodDef.Key,
          Kind: 'method',
          Value: methodDef.Closure,
          Decorators: undefined,
        });
      }
    }
    case !!MethodDefinition.PropertySetParameterList: {
      const { ClassElementName, PropertySetParameterList, FunctionBody } = MethodDefinition;
      // 1. Let propKey be the result of evaluating ClassElementName.
      const propKey = Q(yield* Evaluate_PropertyName(ClassElementName));
      // 3. Let scope be the running execution context's LexicalEnvironment.
      const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      // 4. Let privateScope be the running execution context's PrivateEnvironment.
      const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
      // 5. Let sourceText be the source text matched by MethodDefinition.
      const sourceText = sourceTextMatchedBy(MethodDefinition);
      // 6. Let closure be OrdinaryFunctionCreate(%Function.prototype%, sourceText, PropertySetParameterList, FunctionBody, non-lexical-this, scope, privateScope).
      const closure = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), sourceText, PropertySetParameterList, FunctionBody, 'non-lexical-this', scope, privateScope);
      // 7. Perform MakeMethod(closure, object).
      MakeMethod(closure, object);
      // 8. Perform SetFunctionName(closure, propKey, "set").
      SetFunctionName(closure, propKey, 'set');
      if (enumerable !== undefined) {
        // 9. If propKey is a Private Name, then
        if (propKey instanceof PrivateName) {
        // a. Return PrivateElement { [[Key]]: propKey, [[Kind]]: accessor, [[Get]]: undefined, [[Set]]: closure }.
          return PrivateElementRecord({
            Key: propKey,
            Kind: 'accessor',
            Get: Value.undefined,
            Set: closure,
          });
        } else { // 10. Else,
        // a. Let desc be the PropertyDescriptor { [[Get]]: closure, [[Enumerable]]: enumerable, [[Configurable]]: true }.
          const desc = Descriptor({
            Set: closure,
            Enumerable: enumerable,
            Configurable: true,
          });
          // b. Perform ? DefinePropertyOrThrow(object, propKey, desc).
          Q(yield* DefinePropertyOrThrow(object, propKey, desc));
          // c. Return empty.
          return undefined;
        }
      } else {
        return ClassElementDefinitionRecord({
          Key: propKey,
          Kind: 'setter',
          Set: closure,
          Decorators: undefined,
        });
      }
    }
    case !MethodDefinition.UniqueFormalParameters && !MethodDefinition.PropertySetParameterList: {
      const { ClassElementName, FunctionBody } = MethodDefinition;
      // 1. Let propKey be the result of evaluating ClassElementName.
      const propKey = Q(yield* Evaluate_PropertyName(ClassElementName));
      // 3. Let scope be the running execution context's LexicalEnvironment.
      const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      // 4. Let privateScope be the running execution context's PrivateEnvironment.
      const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
      // 5. Let formalParameterList be an instance of the production FormalParameters : [empty].
      const formalParameterList: ParseNode.FormalParameters = [];
      // 6. Let sourceText be the source text matched by MethodDefinition.
      const sourceText = sourceTextMatchedBy(MethodDefinition);
      // 7. Let closure be OrdinaryFunctionCreate(%Function.prototype%, sourceText, formalParameterList, FunctionBody, non-lexical-this, scope, privateScope).
      const closure = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), sourceText, formalParameterList, FunctionBody, 'non-lexical-this', scope, privateScope);
      // 8. Perform MakeMethod(closure, object).
      MakeMethod(closure, object);
      // 9. Perform SetFunctionName(closure, propKey, "get").
      SetFunctionName(closure, propKey, 'get');
      if (enumerable !== undefined) {
        // 10. If propKey is a Private Name, then
        if (propKey instanceof PrivateName) {
          return PrivateElementRecord({
            Key: propKey,
            Kind: 'accessor',
            Get: closure,
            Set: Value.undefined,
          });
        } else { // 11. Else,
          // a. Let desc be the PropertyDescriptor { [[Get]]: closure, [[Enumerable]]: enumerable, [[Configurable]]: true }.
          const desc = Descriptor({
            Get: closure,
            Enumerable: enumerable,
            Configurable: true,
          });
          // b. Perform ? DefinePropertyOrThrow(object, propKey, desc).
          Q(yield* DefinePropertyOrThrow(object, propKey, desc));
          // c. Return empty.
          return undefined;
        }
      } else {
        return ClassElementDefinitionRecord({
          Key: propKey,
          Kind: 'getter',
          Get: closure,
          Decorators: undefined,
        });
      }
    }
    default:
      throw OutOfRange.nonExhaustive(MethodDefinition);
  }
}

/** https://tc39.es/ecma262/#sec-async-function-definitions-MethodDefinitionEvaluation */
//   AsyncMethod :
//     `async` ClassElementName `(` UniqueFormalParameters `)` `{` AsyncBody `}`
// -decorator signature
function MethodDefinitionEvaluation_AsyncMethod(AsyncMethod: ParseNode.AsyncMethod, object: ObjectValue, enumerable: boolean): PlainEvaluator<PrivateElementRecord | void>
// +decorator signature
function MethodDefinitionEvaluation_AsyncMethod(AsyncMethod: ParseNode.AsyncMethod, object: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord>
function* MethodDefinitionEvaluation_AsyncMethod(AsyncMethod: ParseNode.AsyncMethod, object: ObjectValue, enumerable?: boolean): PlainEvaluator<ClassElementDefinitionRecord | PrivateElementRecord | void> {
  const { ClassElementName, UniqueFormalParameters, AsyncBody } = AsyncMethod;
  // 1. Let propKey be the result of evaluating ClassElementName.
  const propKey = Q(yield* Evaluate_PropertyName(ClassElementName));
  // 3. Let scope be the LexicalEnvironment of the running execution context.
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 4. Let privateScope be the running execution context's PrivateEnvironment.
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 5. Let sourceText be the source text matched by AsyncMethod.
  const sourceText = sourceTextMatchedBy(AsyncMethod);
  // 6. Let closure be ! OrdinaryFunctionCreate(%AsyncFunction.prototype%, sourceText, UniqueFormalParameters, AsyncBody, non-lexical-this, scope, privateScope).
  const closure = X(OrdinaryFunctionCreate(surroundingAgent.intrinsic('%AsyncFunction.prototype%'), sourceText, UniqueFormalParameters, AsyncBody, 'non-lexical-this', scope, privateScope));
  // 7. Perform ! MakeMethod(closure, object).
  X(MakeMethod(closure, object));
  // 8. Perform ! SetFunctionName(closure, propKey).
  X(SetFunctionName(closure, propKey));
  if (enumerable !== undefined) {
    // 9. Return ? DefineMethodProperty(propKey, object, closure, enumerable).
    return Q(yield* DefineMethodProperty(propKey, object, closure, enumerable));
  } else {
    return ClassElementDefinitionRecord({
      Key: propKey,
      Kind: 'method',
      Value: closure,
      Decorators: undefined,
    });
  }
}

/** https://tc39.es/ecma262/#sec-generator-function-definitions-runtime-semantics-propertydefinitionevaluation */
//   GeneratorMethod :
//     `*` ClassElementName `(` UniqueFormalParameters `)` `{` GeneratorBody `}`
function MethodDefinitionEvaluation_GeneratorMethod(GeneratorMethod: ParseNode.GeneratorMethod, object: ObjectValue, enumerable: boolean): PlainEvaluator<PrivateElementRecord | void>
function MethodDefinitionEvaluation_GeneratorMethod(GeneratorMethod: ParseNode.GeneratorMethod, object: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord>
function* MethodDefinitionEvaluation_GeneratorMethod(GeneratorMethod: ParseNode.GeneratorMethod, object: ObjectValue, enumerable?: boolean): PlainEvaluator<ClassElementDefinitionRecord | PrivateElementRecord | void> {
  const { ClassElementName, UniqueFormalParameters, GeneratorBody } = GeneratorMethod;
  // 1. Let propKey be the result of evaluating ClassElementName.
  let propKey = yield* Evaluate_PropertyName(ClassElementName);
  propKey = Q(propKey);
  // 3. Let scope be the LexicalEnvironment of the running execution context.
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 4. Let privateScope be the running execution context's PrivateEnvironment.
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 5. Let sourceText be the source text matched by GeneratorMethod.
  const sourceText = sourceTextMatchedBy(GeneratorMethod);
  // 6. Let closure be ! OrdinaryFunctionCreate(%GeneratorFunction.prototype%, sourceText, UniqueFormalParameters, AsyncBody, non-lexical-this, scope, privateScope).
  const closure = X(OrdinaryFunctionCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype%'), sourceText, UniqueFormalParameters, GeneratorBody, 'non-lexical-this', scope, privateScope));
  // 7. Perform ! MakeMethod(closure, object).
  X(MakeMethod(closure, object));
  // 8. Perform ! SetFunctionName(closure, propKey).
  X(SetFunctionName(closure, propKey));
  // 9. Let prototype be OrdinaryObjectCreate(%GeneratorFunction.prototype.prototype%).
  const prototype = OrdinaryObjectCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype.prototype%'));
  // 10. Perform DefinePropertyOrThrow(closure, "prototype", PropertyDescriptor { [[Value]]: prototype, [[Writable]]: true, [[Enumerable]]: false, [[Configurable]]: false }).
  X(DefinePropertyOrThrow(closure, 'prototype', Descriptor({
    Value: prototype,
    Writable: true,
    Enumerable: false,
    Configurable: false,
  })));
  if (enumerable !== undefined) {
    // 11. Return ? DefineMethodProperty(propKey, object, closure, enumerable).
    return Q(yield* DefineMethodProperty(propKey, object, closure, enumerable));
  } else {
    return ClassElementDefinitionRecord({
      Key: propKey,
      Kind: 'method',
      Value: closure,
      Decorators: undefined,
    });
  }
}

/** https://tc39.es/ecma262/#sec-asyncgenerator-definitions-propertydefinitionevaluation */
//   AsyncGeneratorMethod :
//     `async` `*` PropertyName `(` UniqueFormalParameters `)` `{` AsyncGeneratorBody `}`
function MethodDefinitionEvaluation_AsyncGeneratorMethod(AsyncGeneratorMethod: ParseNode.AsyncGeneratorMethod, object: ObjectValue, enumerable: boolean): PlainEvaluator<PrivateElementRecord | void>
function MethodDefinitionEvaluation_AsyncGeneratorMethod(AsyncGeneratorMethod: ParseNode.AsyncGeneratorMethod, object: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord>
function* MethodDefinitionEvaluation_AsyncGeneratorMethod(AsyncGeneratorMethod: ParseNode.AsyncGeneratorMethod, object: ObjectValue, enumerable?: boolean): PlainEvaluator<ClassElementDefinitionRecord | PrivateElementRecord | void> {
  const { ClassElementName, UniqueFormalParameters, AsyncGeneratorBody } = AsyncGeneratorMethod;
  // 1. Let propKey be the result of evaluating ClassElementName.
  let propKey = yield* Evaluate_PropertyName(ClassElementName);
  propKey = Q(propKey);
  // 3. Let scope be the LexicalEnvironment of the running execution context.
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 4. Let privateScope be the running execution context's PrivateEnvironment.
  const privateEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 5. Let sourceText be the source text matched by AsyncGeneratorMethod.
  const sourceText = sourceTextMatchedBy(AsyncGeneratorMethod);
  // 6. Let closure be ! OrdinaryFunctionCreate(%AsyncGeneratorFunction.prototype%, sourceText, UniqueFormalParameters, AsyncGeneratorBody, non-lexical-this, scope, privateScope).
  const closure = X(OrdinaryFunctionCreate(surroundingAgent.intrinsic('%AsyncGeneratorFunction.prototype%'), sourceText, UniqueFormalParameters, AsyncGeneratorBody, 'non-lexical-this', scope, privateEnv));
  // 7. Perform ! MakeMethod(closure, object).
  X(MakeMethod(closure, object));
  // 9. Perform ! SetFunctionName(closure, propKey).
  X(SetFunctionName(closure, propKey));
  // 9. Let prototype be OrdinaryObjectCreate(%AsyncGeneratorFunction.prototype.prototype%).
  const prototype = OrdinaryObjectCreate(surroundingAgent.intrinsic('%AsyncGeneratorFunction.prototype.prototype%'));
  // 10. Perform DefinePropertyOrThrow(closure, "prototype", PropertyDescriptor { [[Value]]: prototype, [[Writable]]: true, [[Enumerable]]: false, [[Configurable]]: false }).
  X(DefinePropertyOrThrow(closure, 'prototype', Descriptor({
    Value: prototype,
    Writable: true,
    Enumerable: false,
    Configurable: false,
  })));
  if (enumerable !== undefined) {
    // 11. Return ? DefineMethodProperty(propKey, object, closure, enumerable).
    return Q(yield* DefineMethodProperty(propKey, object, closure, enumerable));
  } else {
    return ClassElementDefinitionRecord({
      Key: propKey,
      Kind: 'method',
      Value: closure,
      Decorators: undefined,
    });
  }
}

// -decorator
export function MethodDefinitionEvaluation(node: ParseNode.MethodDefinitionLike, object: ObjectValue, enumerable: boolean): PlainEvaluator<PrivateElementRecord | void>
// +decorator
export function MethodDefinitionEvaluation(node: ParseNode.MethodDefinitionLike, object: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord>
export function MethodDefinitionEvaluation(node: ParseNode.MethodDefinitionLike, object: ObjectValue, enumerable?: boolean): PlainEvaluator<ClassElementDefinitionRecord | PrivateElementRecord | void> {
  if (enumerable !== undefined) {
    switch (node.type) {
      case 'MethodDefinition':
        return MethodDefinitionEvaluation_MethodDefinition(node, object, enumerable);
      case 'AsyncMethod':
        return MethodDefinitionEvaluation_AsyncMethod(node, object, enumerable);
      case 'GeneratorMethod':
        return MethodDefinitionEvaluation_GeneratorMethod(node, object, enumerable);
      case 'AsyncGeneratorMethod':
        return MethodDefinitionEvaluation_AsyncGeneratorMethod(node, object, enumerable);
      default:
        throw OutOfRange.exhaustive(node);
    }
  } else {
    switch (node.type) {
      case 'MethodDefinition':
        return MethodDefinitionEvaluation_MethodDefinition(node, object);
      case 'AsyncMethod':
        return MethodDefinitionEvaluation_AsyncMethod(node, object);
      case 'GeneratorMethod':
        return MethodDefinitionEvaluation_GeneratorMethod(node, object);
      case 'AsyncGeneratorMethod':
        return MethodDefinitionEvaluation_AsyncGeneratorMethod(node, object);
      default:
        throw OutOfRange.exhaustive(node);
    }
  }
}
