import { surroundingAgent, type ParseNode } from '#self';

const ShouldSkipStepIn: readonly ParseNode['type'][] = [
  'NumericLiteral', 'NullLiteral', 'StringLiteral', 'BooleanLiteral', 'RegularExpressionLiteral',
  'CallExpression',
  'Block',
];

export function shouldStepOnNode() {
  const type = surroundingAgent.runningExecutionContext.callSite.lastNode?.type;
  if (type && !type.endsWith('Statement') && !type.endsWith('Declaration') && !ShouldSkipStepIn.includes(type)) {
    return true;
  }
  return false;
}
