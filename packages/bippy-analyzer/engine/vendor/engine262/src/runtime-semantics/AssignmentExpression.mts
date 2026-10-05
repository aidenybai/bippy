import { JSStringValue, ReferenceRecord, Value } from '../value.mts';
import { Q, X } from '../completion.mts';
import {
  IsAnonymousFunctionDefinition,
  IsIdentifierRef,
  type DestructuringParseNode,
  type FunctionDeclaration,
} from '../static-semantics/all.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  NamedEvaluation,
  ApplyStringOrNumericBinaryOperator,
  DestructuringAssignmentEvaluation,
} from './all.mts';
import {
  GetValue,
  PutValue,
  ToBoolean,
} from '#self';


/** https://tc39.es/ecma262/#sec-destructuring-assignment */
export function refineLeftHandSideExpression(node: ParseNode.ArrayLiteral | ParseNode.ObjectLiteral | ParseNode.PropertyDefinition | ParseNode.MemberExpression | ParseNode.CoverInitializedName | ParseNode.AssignmentExpression | ParseNode.Elision | ParseNode.IdentifierReference | ParseNode.ElementListElement | DestructuringParseNode | ParseNode.Expression, type?: 'array' | 'object'): ParseNode.AssignmentPattern {
  switch (node.type) {
    case 'ArrayLiteral': {
      const refinement: ParseNode.ArrayAssignmentPattern = {
        type: 'ArrayAssignmentPattern',
        AssignmentElementList: [],
        AssignmentRestElement: undefined,
      };
      node.ElementList.forEach((n) => {
        switch (n.type) {
          case 'SpreadElement':
            refinement.AssignmentRestElement = {
              ...n,
              type: 'AssignmentRestElement',
              AssignmentExpression: n.AssignmentExpression,
            };
            break;
          case 'ArrayLiteral':
          case 'ObjectLiteral':
            refinement.AssignmentElementList.push({
              type: 'AssignmentElement',
              DestructuringAssignmentTarget: n,
              Initializer: null,
            });
            break;
          default:
            refinement.AssignmentElementList.push(refineLeftHandSideExpression(n, 'array'));
            break;
        }
      });
      return refinement;
    }
    case 'ObjectLiteral': {
      const refined: ParseNode.ObjectAssignmentPattern = {
        type: 'ObjectAssignmentPattern',
        AssignmentPropertyList: [],
        AssignmentRestProperty: undefined,
      };
      node.PropertyDefinitionList.forEach((p) => {
        if ((p as ParseNode.PropertyDefinition).PropertyName === null && (p as ParseNode.PropertyDefinition).AssignmentExpression) {
          refined.AssignmentRestProperty = {
            type: 'AssignmentRestProperty',
            DestructuringAssignmentTarget: (p as ParseNode.PropertyDefinition).AssignmentExpression,
          };
        } else {
          refined.AssignmentPropertyList.push(refineLeftHandSideExpression(p as ParseNode.PropertyDefinition, 'object'));
        }
      });
      return refined;
    }
    case 'PropertyDefinition':
      return {
        type: 'AssignmentProperty',
        PropertyName: node.PropertyName,
        AssignmentElement: node.AssignmentExpression.type === 'AssignmentExpression'
          ? {
            type: 'AssignmentElement',
            DestructuringAssignmentTarget: node.AssignmentExpression.LeftHandSideExpression,
            Initializer: node.AssignmentExpression.AssignmentExpression,
          }
          : {
            type: 'AssignmentElement',
            DestructuringAssignmentTarget: node.AssignmentExpression,
            Initializer: undefined,
          },
      };
    case 'IdentifierReference':
      if (type === 'array') {
        return {
          type: 'AssignmentElement',
          DestructuringAssignmentTarget: node,
          Initializer: undefined,
        };
      } else {
        return {
          type: 'AssignmentProperty',
          IdentifierReference: node,
          Initializer: undefined,
        };
      }
    case 'MemberExpression':
    case 'SuperProperty':
      return {
        type: 'AssignmentElement',
        DestructuringAssignmentTarget: node,
        Initializer: undefined,
      };
    case 'CoverInitializedName':
      return {
        type: 'AssignmentProperty',
        IdentifierReference: node.IdentifierReference,
        Initializer: node.Initializer,
      };
    case 'AssignmentExpression':
      return {
        type: 'AssignmentElement',
        DestructuringAssignmentTarget: node.LeftHandSideExpression,
        Initializer: node.AssignmentExpression,
      };
    case 'Elision':
      return node;
    case 'ParenthesizedExpression':
      return refineLeftHandSideExpression(node.Expression, type);
    default:
      throw OutOfRange.nonExhaustive(node.type);
  }
}

/** https://tc39.es/ecma262/#sec-assignment-operators-runtime-semantics-evaluation */
//   AssignmentExpression :
//     LeftHandSideExpression `=` AssignmentExpression
//     LeftHandSideExpression AssignmentOperator AssignmentExpression
//     LeftHandSideExpression `&&=` AssignmentExpression
//     LeftHandSideExpression `||=` AssignmentExpression
//     LeftHandSideExpression `??=` AssignmentExpression
export function* Evaluate_AssignmentExpression({
  LeftHandSideExpression, AssignmentOperator, AssignmentExpression,
}: ParseNode.AssignmentExpression): ValueEvaluator {
  if (AssignmentOperator === '=') {
    // 1. If LeftHandSideExpression is neither an ObjectLiteral nor an ArrayLiteral, then
    if (LeftHandSideExpression.type !== 'ObjectLiteral' && LeftHandSideExpression.type !== 'ArrayLiteral') {
      // a. Let lref be the result of evaluating LeftHandSideExpression.
      const lref = Q(yield* Evaluate(LeftHandSideExpression));
      Q(lref);
      // c. If IsAnonymousFunctionDefinition(AssignmentExpression) and IsIdentifierRef of LeftHandSideExpression are both true, then
      let rval;
      if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
        // i. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
        rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
      } else { // d. Else,
        // i. Let rref be the result of evaluating AssignmentExpression.
        const rref = Q(yield* Evaluate(AssignmentExpression));
        // ii. Let rval be ? GetValue(rref).
        rval = Q(yield* GetValue(rref));
      }
      // e. Perform ? PutValue(lref, rval).
      Q(yield* PutValue(lref, rval));
      // f. Return rval.
      return rval;
    }
    // 2. Let assignmentPattern be the AssignmentPattern that is covered by LeftHandSideExpression.
    const assignmentPattern = refineLeftHandSideExpression(LeftHandSideExpression);
    // 3. Let rref be the result of evaluating AssignmentExpression.
    const rref = Q(yield* Evaluate(AssignmentExpression));
    // 3. Let rval be ? GetValue(rref).
    const rval = Q(yield* GetValue(rref));
    // 4. Perform ? DestructuringAssignmentEvaluation of assignmentPattern using rval as the argument.
    Q(yield* DestructuringAssignmentEvaluation(assignmentPattern as ParseNode.ObjectAssignmentPattern | ParseNode.ArrayAssignmentPattern, rval));
    // 5. Return rval.
    return rval;
  } else if (AssignmentOperator === '&&=') {
    // 1. Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(yield* Evaluate(LeftHandSideExpression));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. Let lbool be ! ToBoolean(lval).
    const lbool = ToBoolean(lval);
    // 4. If lbool is false, return lval.
    if (!lbool) {
      return lval;
    }
    let rval;
    // 5. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and IsIdentifierRef of LeftHandSideExpression is true, then
    if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
      // a. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
      rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
    } else { // 6. Else,
      // a. Let rref be the result of evaluating AssignmentExpression.
      const rref = Q(yield* Evaluate(AssignmentExpression));
      // b. Let rval be ? GetValue(rref).
      rval = Q(yield* GetValue(rref));
    }
    // 7. Perform ? PutValue(lref, rval).
    Q(yield* PutValue(lref, rval));
    // 8. Return rval.
    return rval;
  } else if (AssignmentOperator === '||=') {
    // 1. Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(yield* Evaluate(LeftHandSideExpression));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. Let lbool be ! ToBoolean(lval).
    const lbool = X(ToBoolean(lval));
    // 4. If lbool is true, return lval.
    if (lbool) {
      return lval;
    }
    let rval;
    // 5. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and IsIdentifierRef of LeftHandSideExpression is true, then
    if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
      // a. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
      rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
    } else { // 6. Else,
      // a. Let rref be the result of evaluating AssignmentExpression.
      const rref = Q(yield* Evaluate(AssignmentExpression));
      // b. Let rval be ? GetValue(rref).
      rval = Q(yield* GetValue(rref));
    }
    // 7. Perform ? PutValue(lref, rval).
    Q(yield* PutValue(lref, rval));
    // 8. Return rval.
    return rval;
  } else if (AssignmentOperator === '??=') {
    // 1.Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(yield* Evaluate(LeftHandSideExpression));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. If lval is not undefined nor null, return lval.
    if (lval !== Value.undefined && lval !== Value.null) {
      return lval;
    }
    let rval;
    // 4. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and IsIdentifierRef of LeftHandSideExpression is true, then
    if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
      // a. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
      rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
    } else { // 5. Else,
      // a. Let rref be the result of evaluating AssignmentExpression.
      const rref = Q(yield* Evaluate(AssignmentExpression));
      // b. Let rval be ? GetValue(rref).
      rval = Q(yield* GetValue(rref));
    }
    // 6. Perform ? PutValue(lref, rval).
    Q(yield* PutValue(lref, rval));
    // 7. Return rval.
    return rval;
  } else {
    // 1. Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(yield* Evaluate(LeftHandSideExpression));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. Let rref be the result of evaluating AssignmentExpression.
    const rref = Q(yield* Evaluate(AssignmentExpression));
    // 4. Let rval be ? GetValue(rref).
    const rval = Q(yield* GetValue(rref));
    // 5. Let assignmentOpText be the source text matched by AssignmentOperator.
    const assignmentOpText = AssignmentOperator;
    // 6. Let opText be the sequence of Unicode code points associated with assignmentOpText in the following table:
    const opText = ({
      '**=': '**',
      '*=': '*',
      '/=': '/',
      '%=': '%',
      '+=': '+',
      '-=': '-',
      '<<=': '<<',
      '>>=': '>>',
      '>>>=': '>>>',
      '&=': '&',
      '^=': '^',
      '|=': '|',
    } as const)[assignmentOpText];
    // 7. Let r be ApplyStringOrNumericBinaryOperator(lval, opText, rval).
    const r = Q(yield* ApplyStringOrNumericBinaryOperator(lval, opText, rval));
    // 8. Perform ? PutValue(lref, r).
    Q(yield* PutValue(lref, r));
    // 9. Return r.
    return r;
  }
}
