import type { ParseNode } from '../parser/ParseNode.mts';

/** https://tc39.es/ecma262/#sec-static-semantics-bodytext */
//  RegularExpressionLiteral :: `/` RegularExpressionBody `/` RegularExpressionFlags
export function BodyText(RegularExpressionLiteral: ParseNode.RegularExpressionLiteral) {
  return RegularExpressionLiteral.RegularExpressionBody;
}
