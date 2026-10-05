import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import type { Value } from '../value.mts';
import type { EnvironmentRecord } from '../execution-context/Environment.mts';
import { BindingInitialization } from './BindingInitialization.mts';
import { Q, Throw } from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-fordeclarationbindinginitialization */
export function* ForDeclarationBindingInitialization(
  declaration: ParseNode.ForDeclaration,
  value: Value,
  envRecord: EnvironmentRecord,
): PlainEvaluator {
  switch (declaration.production) {
    case 'LetOrConst':
      return Q(yield* BindingInitialization(declaration.ForBinding, value, envRecord));
    case 'Using':
    case 'AwaitUsing':
      return Throw.SyntaxError('Invalid ForDeclaration binding initialization');
  }
}
