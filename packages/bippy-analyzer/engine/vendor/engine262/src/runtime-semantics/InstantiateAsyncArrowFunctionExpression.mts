import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent, OrdinaryFunctionCreate, SetFunctionName, sourceTextMatchedBy,
} from '#self';
import type { PrivateName, PropertyKeyValue } from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-instantiateasyncarrowfunctionexpression */
// AsyncArrowFunction : ArrowParameters `=>` AsyncConciseBody
export function InstantiateAsyncArrowFunctionExpression(AsyncArrowFunction: ParseNode.AsyncArrowFunction, name?: string | PropertyKeyValue | PrivateName) {
  const { ArrowParameters, AsyncConciseBody } = AsyncArrowFunction;
  // 1. If name is not present, set name to "".
  if (name === undefined) {
    name = Value('');
  }
  // 2. Let scope be the LexicalEnvironment of the running execution context.
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 3. Let privateScope be the running execution context's PrivateEnvironment.
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 4. Let sourceText be the source text matched by AsyncArrowFunction.
  const sourceText = sourceTextMatchedBy(AsyncArrowFunction);
  // 5. Let parameters be AsyncArrowBindingIdentifier.
  const parameters = ArrowParameters;
  // 6. Let closure be OrdinaryFunctionCreate(%AsyncFunction.prototype%, sourceText, ArrowParameters, AsyncConciseBody, lexical-this, scope, privateScope).
  const closure = OrdinaryFunctionCreate(
    surroundingAgent.intrinsic('%AsyncFunction.prototype%'),
    sourceText,
    parameters,
    AsyncConciseBody,
    'lexical-this',
    scope,
    privateScope,
  );
  // 7. Perform SetFunctionName(closure, name).
  SetFunctionName(closure, name);
  // 8. Return closure.
  return closure;
}
