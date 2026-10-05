import { F } from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-mv-s */
//   StringNumericLiteral :::
//     [empty]
//     StrWhiteSpace
//     StrWhiteSpace_opt StrNumericLiteral StrWhiteSpace_opt
export function MV_StringNumericLiteral(StringNumericLiteral: string) {
  return F(Number(StringNumericLiteral));
}
