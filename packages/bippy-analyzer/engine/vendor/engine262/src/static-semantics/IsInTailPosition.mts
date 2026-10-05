import type { ParseNode } from '../parser/ParseNode.mts';
import { ContainsUsing } from './ContainsUsing.mts';

const hasPrecedingDisposal = (statements: ParseNode.StatementList, child: ParseNode): boolean => {
  for (const statement of statements) {
    if (statement === child) return false;
    if (ContainsUsing(statement)) return true;
  }
  return false;
};

export const IsInTailPosition = (node: ParseNode): boolean => {
  if (!node.strict) return false;
  let child = node;
  let isReturning = false;
  while (child.parent) {
    const parent = child.parent;
    if (!isReturning) {
      switch (parent.type) {
        case 'ParenthesizedExpression':
          break;
        case 'CommaOperator':
          if (parent.ExpressionList.at(-1) !== child) return false;
          break;
        case 'ConditionalExpression':
          if (parent.AssignmentExpression_a !== child && parent.AssignmentExpression_b !== child) return false;
          break;
        case 'LogicalANDExpression':
        case 'CoalesceExpression':
          if (parent.BitwiseORExpression !== child) return false;
          break;
        case 'LogicalORExpression':
          if (parent.LogicalANDExpression !== child) return false;
          break;
        case 'OptionalExpression':
          if (parent.OptionalChain !== child) return false;
          break;
        case 'ReturnStatement':
          isReturning = true;
          break;
        case 'ExpressionBody':
          return parent.parent?.type === 'ConciseBody' && parent.parent.parent?.type === 'ArrowFunction';
        default:
          return false;
      }
    } else {
      switch (parent.type) {
        case 'FunctionBody':
          return !hasPrecedingDisposal(parent.FunctionStatementList, child);
        case 'Block':
        case 'CaseClause':
        case 'DefaultClause':
          if (hasPrecedingDisposal(parent.StatementList, child)) return false;
          break;
        case 'ForStatement':
          if (parent.LexicalDeclaration && ContainsUsing(parent.LexicalDeclaration)) return false;
          break;
        case 'CaseBlock':
          if (parent.CaseClauses_a?.some((clause) => ContainsUsing(clause.StatementList ?? [])) ||
            (parent.DefaultClause && ContainsUsing(parent.DefaultClause.StatementList ?? [])) ||
            parent.CaseClauses_b?.some((clause) => ContainsUsing(clause.StatementList ?? []))) return false;
          break;
        case 'TryStatement':
          if ((parent.Finally ?? parent.Catch) !== child) return false;
          break;
        case 'Catch':
        case 'IfStatement':
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ForInStatement':
        case 'WithStatement':
        case 'LabelledStatement':
        case 'SwitchStatement':
          break;
        default:
          return false;
      }
    }
    child = parent;
  }
  return false;
};
