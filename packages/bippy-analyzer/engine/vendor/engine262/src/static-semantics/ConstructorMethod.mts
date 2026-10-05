import type { ParseNode } from '../parser/ParseNode.mts';
import { PropName } from './all.mts';

/** https://tc39.es/ecma262/#sec-static-semantics-constructormethod */
// ClassElementList :
//   ClassElement
//   ClassElementList ClassElement
export function ConstructorMethod(ClassElementList: ParseNode.ClassElementList): ParseNode.MethodDefinition | undefined {
  return ClassElementList.find((ClassElement) => ClassElement.static === false && PropName(ClassElement) === 'constructor') as ParseNode.MethodDefinition;
}
