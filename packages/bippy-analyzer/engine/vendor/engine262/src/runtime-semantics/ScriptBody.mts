import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate_StatementList } from './all.mts';

// ScriptBody : StatementList
export function Evaluate_ScriptBody(ScriptBody: ParseNode.ScriptBody) {
  return Evaluate_StatementList(ScriptBody.StatementList);
}
