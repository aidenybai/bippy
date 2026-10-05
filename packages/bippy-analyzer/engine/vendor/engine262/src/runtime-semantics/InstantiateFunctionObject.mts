import { X } from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import { Descriptor, Value } from '../value.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent,
  DefinePropertyOrThrow,
  MakeConstructor,
  OrdinaryObjectCreate,
  SetFunctionName,
  OrdinaryFunctionCreate,
  sourceTextMatchedBy,
} from '#self';
import type { EnvironmentRecord, PrivateEnvironmentRecord } from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-instantiatefunctionobject */
//   FunctionDeclaration :
//     `function` BindingIdentifier `(` FormalParameters `)` `{` FunctionBody `}`
//     `function` `(` FormalParameters `)` `{` FunctionBody `}`
export function InstantiateFunctionObject_FunctionDeclaration(FunctionDeclaration: ParseNode.FunctionDeclaration, env: EnvironmentRecord, privateEnv: PrivateEnvironmentRecord | null) {
  const { BindingIdentifier, FormalParameters, FunctionBody } = FunctionDeclaration;
  // 1. Let name be StringValue of BindingIdentifier.
  const name = BindingIdentifier ? StringValue(BindingIdentifier) : Value('default');
  // 2. Let sourceText be the source text matched by FunctionDeclaration.
  const sourceText = sourceTextMatchedBy(FunctionDeclaration);
  // 3. Let F be OrdinaryFunctionCreate(%Function.prototype%, sourceText, FormalParameters, FunctionBody, non-lexical-this, scope, privateScope).
  const F = X(OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), sourceText, FormalParameters, FunctionBody, 'non-lexical-this', env, privateEnv));
  // 4. Perform SetFunctionName(F, name).
  SetFunctionName(F, name);
  // 5. Perform MakeConstructor(F).
  MakeConstructor(F);
  // 6. Return F.
  return F;
}

/** https://tc39.es/ecma262/#sec-generator-function-definitions-runtime-semantics-instantiatefunctionobject */
//   GeneratorDeclaration :
//     `function` `*` BindingIdentifier `(` FormalParameters `)` `{` GeneratorBody `}`
//     `function` `*` `(` FormalParameters `)` `{` GeneratorBody `}`
export function InstantiateFunctionObject_GeneratorDeclaration(GeneratorDeclaration: ParseNode.GeneratorDeclaration, env: EnvironmentRecord, privateEnv: PrivateEnvironmentRecord | null) {
  const { BindingIdentifier, FormalParameters, GeneratorBody } = GeneratorDeclaration;
  // 1. Let name be StringValue of BindingIdentifier.
  const name = BindingIdentifier ? StringValue(BindingIdentifier) : Value('default');
  // 2. Let sourceText be the source text matched by GeneratorDeclaration.
  const sourceText = sourceTextMatchedBy(GeneratorDeclaration);
  // 3. Let F be OrdinaryFunctionCreate(%GeneratorFunction.prototype%, sourceText, FormalParameters, GeneratorBody, non-lexical-this, scope, privateScope).
  const F = X(OrdinaryFunctionCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype%'), sourceText, FormalParameters, GeneratorBody, 'non-lexical-this', env, privateEnv));
  // 4. Perform SetFunctionName(F, name).
  SetFunctionName(F, name);
  // 5. Let prototype be OrdinaryObjectCreate(%GeneratorFunction.prototype.prototype%).
  const prototype = X(OrdinaryObjectCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype.prototype%')));
  // 6. Perform DefinePropertyOrThrow(F, "prototype", PropertyDescriptor { [[Value]]: prototype, [[Writable]]: true, [[Enumerable]]: false, [[Configurable]]: false }).
  X(DefinePropertyOrThrow(F, 'prototype', Descriptor({
    Value: prototype,
    Writable: true,
    Enumerable: false,
    Configurable: false,
  })));
  // 7. Return F.
  return F;
}

/** https://tc39.es/ecma262/#sec-async-function-definitions-InstantiateFunctionObject */
//  AsyncFunctionDeclaration :
//    `async` `function` BindingIdentifier `(` FormalParameters `)` `{` AsyncBody `}`
//    `async` `function` `(` FormalParameters `)` `{` AsyncBody `}`
export function InstantiateFunctionObject_AsyncFunctionDeclaration(AsyncFunctionDeclaration: ParseNode.AsyncFunctionDeclaration, env: EnvironmentRecord, privateEnv: PrivateEnvironmentRecord | null) {
  const { BindingIdentifier, FormalParameters, AsyncBody } = AsyncFunctionDeclaration;
  // 1. Let name be StringValue of BindingIdentifier.
  const name = BindingIdentifier ? StringValue(BindingIdentifier) : Value('default');
  // 2. Let sourceText be the source text matched by AsyncFunctionDeclaration.
  const sourceText = sourceTextMatchedBy(AsyncFunctionDeclaration);
  // 3. Let F be ! OrdinaryFunctionCreate(%AsyncFunction.prototype%, sourceText, FormalParameters, AsyncBody, non-lexical-this, scope, privateScope).
  const F = X(OrdinaryFunctionCreate(surroundingAgent.intrinsic('%AsyncFunction.prototype%'), sourceText, FormalParameters, AsyncBody, 'non-lexical-this', env, privateEnv));
  // 4. Perform ! SetFunctionName(F, name).
  SetFunctionName(F, name);
  // 5. Return F.
  return F;
}

/** https://tc39.es/ecma262/#sec-asyncgenerator-definitions-evaluatebody */
//  AsyncGeneratorDeclaration :
//    `async` `function` `*` BindingIdentifier `(` FormalParameters`)` `{` AsyncGeneratorBody `}`
//    `async` `function` `*` `(` FormalParameters`)` `{` AsyncGeneratorBody `}`
export function InstantiateFunctionObject_AsyncGeneratorDeclaration(AsyncGeneratorDeclaration: ParseNode.AsyncGeneratorDeclaration, env: EnvironmentRecord, privateEnv: PrivateEnvironmentRecord | null) {
  const { BindingIdentifier, FormalParameters, AsyncGeneratorBody } = AsyncGeneratorDeclaration;
  // 1. Let name be StringValue of BindingIdentifier.
  const name = BindingIdentifier ? StringValue(BindingIdentifier) : Value('default');
  // 2. Let sourceText be the source text matched by AsyncGeneratorDeclaration.
  const sourceText = sourceTextMatchedBy(AsyncGeneratorDeclaration);
  // 3. Let F be ! OrdinaryFunctionCreate(%AsyncGeneratorFunction.prototype%, sourceText, FormalParameters, AsyncGeneratorBody, non-lexical-this, scope, privateScope).
  const F = X(OrdinaryFunctionCreate(surroundingAgent.intrinsic('%AsyncGeneratorFunction.prototype%'), sourceText, FormalParameters, AsyncGeneratorBody, 'non-lexical-this', env, privateEnv));
  // 4. Perform ! SetFunctionName(F, name).
  SetFunctionName(F, name);
  // 5. Let prototype be ! OrdinaryObjectCreate(%AsyncGeneratorFunction.prototype.prototype%).
  const prototype = X(OrdinaryObjectCreate(surroundingAgent.intrinsic('%AsyncGeneratorFunction.prototype.prototype%')));
  // 6. Perform ! DefinePropertyOrThrow(F, "prototype", PropertyDescriptor { [[Value]]: prototype, [[Writable]]: true, [[Enumerable]]: false, [[Configurable]]: false }).
  X(DefinePropertyOrThrow(F, 'prototype', Descriptor({
    Value: prototype,
    Writable: true,
    Enumerable: false,
    Configurable: false,
  })));
  // 7. Return F.
  return F;
}

export function InstantiateFunctionObject(AnyFunctionDeclaration: ParseNode.FunctionDeclaration | ParseNode.GeneratorDeclaration | ParseNode.AsyncFunctionDeclaration | ParseNode.AsyncGeneratorDeclaration, env: EnvironmentRecord, privateEnv: PrivateEnvironmentRecord | null) {
  switch (AnyFunctionDeclaration.type) {
    case 'FunctionDeclaration':
      return InstantiateFunctionObject_FunctionDeclaration(AnyFunctionDeclaration, env, privateEnv);
    case 'GeneratorDeclaration':
      return InstantiateFunctionObject_GeneratorDeclaration(AnyFunctionDeclaration, env, privateEnv);
    case 'AsyncFunctionDeclaration':
      return InstantiateFunctionObject_AsyncFunctionDeclaration(AnyFunctionDeclaration, env, privateEnv);
    case 'AsyncGeneratorDeclaration':
      return InstantiateFunctionObject_AsyncGeneratorDeclaration(AnyFunctionDeclaration, env, privateEnv);

    default:
      throw OutOfRange.exhaustive(AnyFunctionDeclaration);
  }
}
