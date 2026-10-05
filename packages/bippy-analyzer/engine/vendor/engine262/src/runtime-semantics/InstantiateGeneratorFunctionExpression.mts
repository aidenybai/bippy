import {
  Value, Descriptor, type PropertyKeyValue, PrivateName,
} from '../value.mts';
import { X } from '../completion.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent,
  Assert,
  DefinePropertyOrThrow,
  OrdinaryFunctionCreate,
  OrdinaryObjectCreate,
  SetFunctionName,
  sourceTextMatchedBy,
  DeclarativeEnvironmentRecord,
} from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-instantiategeneratorfunctionexpression */
//   GeneratorExpression :
//     `function` `*` `(` FormalParameters `)` `{` GeneratorBody `}`
//     `function` `* `BindingIdentifier `(` FormalParameters `)` `{` GeneratorBody `}`
export function InstantiateGeneratorFunctionExpression(GeneratorExpression: ParseNode.GeneratorExpression, name?: string | PropertyKeyValue | PrivateName) {
  const { BindingIdentifier, FormalParameters, GeneratorBody } = GeneratorExpression;
  if (BindingIdentifier) {
    // 1. Assert: name is not present.
    Assert(name === undefined);
    // 2. Set name to StringValue of BindingIdentifier.
    name = StringValue(BindingIdentifier);
    // 3. Let scope be the running execution context's LexicalEnvironment.
    const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    // 4. Let funcEnv be NewDeclarativeEnvironment(scope).
    const funcEnv = new DeclarativeEnvironmentRecord(scope);
    // 5. Perform funcEnv.CreateImmutableBinding(name, false).
    funcEnv.CreateImmutableBinding(name, false);
    // 6. Let privateScope be the running execution context's PrivateEnvironment.
    const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
    // 7. Let sourceText be the source text matched by GeneratorExpression.
    const sourceText = sourceTextMatchedBy(GeneratorExpression);
    // 8. Let closure be OrdinaryFunctionCreate(%GeneratorFunction.prototype%, sourceText, FormalParameters, GeneratorBody, non-lexical-this, funcEnv, privateScope).
    const closure = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype%'), sourceText, FormalParameters, GeneratorBody, 'non-lexical-this', funcEnv, privateScope);
    // 9. Perform SetFunctionName(closure, name).
    SetFunctionName(closure, name);
    // 10. Let prototype be ! OrdinaryObjectCreate(%GeneratorFunction.prototype.prototype%).
    const prototype = X(OrdinaryObjectCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype.prototype%')));
    // 11. Perform DefinePropertyOrThrow(closure, "prototype", PropertyDescriptor { [[Value]]: prototype, [[Writable]]: true, [[Enumerable]]: false, [[Configurable]]: false }).
    X(DefinePropertyOrThrow(closure, 'prototype', Descriptor({
      Value: prototype,
      Writable: true,
      Enumerable: false,
      Configurable: false,
    })));
    // 12. Perform funcEnv.InitializeBinding(name, closure).
    X(funcEnv.InitializeBinding(name, closure));
    // 13. Return closure.
    return closure;
  }
  // 1. If name is not present, set name to "".
  if (name === undefined) {
    name = Value('');
  }
  // 2. Let scope be the running execution context's LexicalEnvironment.
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 3. Let privateScope be the running execution context's PrivateEnvironment.
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 4. Let sourceText be the source text matched by GeneratorExpression.
  const sourceText = sourceTextMatchedBy(GeneratorExpression);
  // 5. Let closure be OrdinaryFunctionCreate(%GeneratorFunction.prototype%, sourceText, FormalParameters, GeneratorBody, non-lexical-this, scope, privateScope).
  const closure = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype%'), sourceText, FormalParameters, GeneratorBody, 'non-lexical-this', scope, privateScope);
  // 6. Perform SetFunctionName(closure, name).
  SetFunctionName(closure, name);
  // 7. Let prototype be ! OrdinaryObjectCreate(%GeneratorFunction.prototype.prototype%).
  const prototype = X(OrdinaryObjectCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype.prototype%')));
  // 8. Perform DefinePropertyOrThrow(closure, "prototype", PropertyDescriptor { [[Value]]: prototype, [[Writable]]: true, [[Enumerable]]: false, [[Configurable]]: false }).
  X(DefinePropertyOrThrow(closure, 'prototype', Descriptor({
    Value: prototype,
    Writable: true,
    Enumerable: false,
    Configurable: false,
  })));
  // 9. Return closure.
  return closure;
}
