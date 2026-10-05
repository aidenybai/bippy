import {
  Value, Descriptor, type Arguments,
} from '../value.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import { OutOfRange, isArray } from '../utils/language.mts';
import { TemplateStrings } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent,
  Assert,
  ArrayCreate,
  SetIntegrityLevel,
  ToString,
  GetIterator,
  GetValue,
  F,
  IteratorStepValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-gettemplateobjec */
function GetTemplateObject(templateLiteral: ParseNode.TemplateLiteral) {
  // 1. Let realm be the current Realm Record.
  const realm = surroundingAgent.currentRealmRecord;
  // 2. Let templateRegistry be realm.[[TemplateMap]].
  const templateRegistry = realm.TemplateMap;
  // 3. For each element e of templateRegistry, do
  for (const e of templateRegistry) {
    // a. If e.[[Site]] is the same Parse Node as templateLiteral, then
    if (e.Site === templateLiteral) {
      // b. Return e.[[Array]].
      return e.Array;
    }
  }
  // 4. Let rawStrings be the TemplateStrings of templateLiteral with argument ~raw~.
  const rawStrings = TemplateStrings(templateLiteral, 'raw');
  // 5. Let cookedStrings be the TemplateStrings of templateLiteral with argument ~cooked~.
  const cookedStrings = TemplateStrings(templateLiteral, 'cooked');
  // 6. Let count be the number of elements in the List cookedStrings.
  const count = cookedStrings.length;
  // 7. Assert: count ≤ 232 - 1.
  Assert(count < (2 ** 32) - 1);
  // 8. Let template be ! ArrayCreate(count).
  const template = X(ArrayCreate(count));
  // 9. Let template be ! ArrayCreate(count).
  const rawObj = X(ArrayCreate(count));
  // 10. Let index be 0.
  let index = 0;
  // 11. Repeat, while index < count
  while (index < count) {
    // a. Let prop be ! ToString(𝔽(index)).
    const prop = X(ToString(F(index)));
    // b. Let cookedValue be the String value cookedStrings[index].
    const cookedValue = cookedStrings[index];
    // c. Call template.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: cookedValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    X(template.DefineOwnProperty(prop, Descriptor({
      Value: cookedValue,
      Writable: false,
      Enumerable: true,
      Configurable: false,
    })));
    // d. Let rawValue be the String value rawStrings[index].
    const rawValue = rawStrings[index];
    // e. Call rawObj.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: rawValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    X(rawObj.DefineOwnProperty(prop, Descriptor({
      Value: rawValue,
      Writable: false,
      Enumerable: true,
      Configurable: false,
    })));
    // f. Call rawObj.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: rawValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    index += 1;
  }
  // 12. Perform SetIntegrityLevel(rawObj, frozen).
  X(SetIntegrityLevel(rawObj, 'frozen'));
  // 13. Perform SetIntegrityLevel(rawObj, frozen).
  X(template.DefineOwnProperty(Value('raw'), Descriptor({
    Value: rawObj,
    Writable: false,
    Enumerable: false,
    Configurable: false,
  })));
  // 14. Perform SetIntegrityLevel(template, frozen).
  X(SetIntegrityLevel(template, 'frozen'));
  // 15. Append the Record { [[Site]]: templateLiteral, [[Array]]: template } to templateRegistry.
  templateRegistry.push({ Site: templateLiteral, Array: template });
  // 16. Return template.
  return template;
}

/** https://tc39.es/ecma262/#sec-template-literals-runtime-semantics-argumentlistevaluation */
//   TemplateLiteral : NoSubstitutionTemplate
//
// https://github.com/tc39/ecma262/pull/1402
//   TemplateLiteral : SubstitutionTemplate
function* ArgumentListEvaluation_TemplateLiteral(TemplateLiteral: ParseNode.TemplateLiteral): PlainEvaluator<Arguments> {
  switch (true) {
    case TemplateLiteral.TemplateSpanList.length === 1: {
      const templateLiteral = TemplateLiteral;
      const siteObj = GetTemplateObject(templateLiteral);
      return [siteObj] as Arguments;
    }

    case TemplateLiteral.TemplateSpanList.length > 1: {
      const templateLiteral = TemplateLiteral;
      const siteObj = GetTemplateObject(templateLiteral);
      const restSub = [];
      for (const Expression of TemplateLiteral.ExpressionList) {
        const subRef = Q(yield* Evaluate(Expression));
        const subValue = Q(yield* GetValue(subRef));
        restSub.push(subValue);
      }
      return [siteObj, ...restSub] as Arguments;
    }

    default:
      throw OutOfRange.nonExhaustive(TemplateLiteral);
  }
}

/** https://tc39.es/ecma262/#sec-argument-lists-runtime-semantics-argumentlistevaluation */
//   Arguments : `(` `)`
//   ArgumentList :
//     AssignmentExpression
//     `...` AssignmentExpression
//     ArgumentList `,` AssignmentExpression
//     ArgumentList `,` `...` AssignmentExpression
//
// (implicit)
//   Arguments :
//     `(` ArgumentList `)`
//     `(` ArgumentList `,` `)`
function* ArgumentListEvaluation_Arguments(Arguments: ParseNode.Arguments): PlainEvaluator<Arguments> {
  const precedingArgs = [];
  for (const element of Arguments) {
    if (element.type === 'AssignmentRestElement') {
      const { AssignmentExpression } = element;
      // 2. Let spreadRef be the result of evaluating AssignmentExpression.
      const spreadRef = Q(yield* Evaluate(AssignmentExpression));
      // 3. Let spreadObj be ? GetValue(spreadRef).
      const spreadObj = Q(yield* GetValue(spreadRef));
      // 4. Let iteratorRecord be ? GetIterator(spreadObj).
      const iteratorRecord = Q(yield* GetIterator(spreadObj, 'sync'));
      // 5. Repeat,
      while (true) {
        // a. Let next be ? IteratorStepValue(iteratorRecord).
        const next = Q(yield* IteratorStepValue(iteratorRecord));
        // b. If next is false, return list.
        if (next === 'done') {
          break;
        }
        // d. Append next as the last element of list.
        precedingArgs.push(next);
      }
    } else {
      const AssignmentExpression = element;
      // 2. Let ref be the result of evaluating AssignmentExpression.
      const ref = Q(yield* Evaluate(AssignmentExpression));
      // 3. Let arg be ? GetValue(ref).
      const arg = Q(yield* GetValue(ref));
      // 4. Append arg to the end of precedingArgs.
      precedingArgs.push(arg);
      // 5. Return precedingArgs.
    }
  }
  return precedingArgs as Arguments;
}

export function ArgumentListEvaluation(ArgumentsOrTemplateLiteral: ParseNode.TemplateLiteral | ParseNode.Arguments) {
  switch (true) {
    case isArray(ArgumentsOrTemplateLiteral):
      return ArgumentListEvaluation_Arguments(ArgumentsOrTemplateLiteral);
    case ('type' in ArgumentsOrTemplateLiteral && ArgumentsOrTemplateLiteral.type === 'TemplateLiteral'):
      return ArgumentListEvaluation_TemplateLiteral(ArgumentsOrTemplateLiteral);
    default:
      throw OutOfRange.nonExhaustive(ArgumentsOrTemplateLiteral);
  }
}
