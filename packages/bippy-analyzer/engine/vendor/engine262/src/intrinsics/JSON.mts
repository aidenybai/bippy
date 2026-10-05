import {
  BooleanValue,
  NullValue,
  NumberValue,
  ObjectValue,
  JSStringValue,
  UndefinedValue,
  Value,
} from '../value.mts';
import {
  CodePointsToString,
  PropName,
  UTF16EncodeCodePoint,
} from '../static-semantics/all.mts';
import {
  NormalCompletion,
  Q, X,
} from '../completion.mts';
import { kInternal } from '../utils/internal.mts';
import { isArray } from '../utils/language.mts';
import {
  BigIntValue, F, ParseScript, Realm, ScriptEvaluation, ThrowCompletion, type Arguments,
  type CodePoint,
  type FunctionObject,
  type PlainCompletion,
  isLeadingSurrogate,
  isTrailingSurrogate,
  type ParseNode,
  type BuiltinFunctionObject,
  SetIntegrityLevel,
  SameValue,
  type PropertyKeyValue,
} from '../index.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import {
  ArrayLiteralContentNodes, avoid_using_children, Contains, PropertyDefinitionNodes,
} from '../parser/utils.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { isBooleanObject } from './Boolean.mts';
import { isBigIntObject } from './BigInt.mts';
import {
  surroundingAgent,
  Assert,
  Call,
  CreateDataProperty,
  CreateDataPropertyOrThrow,
  EnumerableOwnProperties,
  Get,
  GetV,
  IsArray,
  IsCallable,
  OrdinaryObjectCreate,
  LengthOfArrayLike,
  ToIntegerOrInfinity,
  ToNumber,
  ToString,
  Throw,
} from '#self';

const WHITESPACE = [' ', '\t', '\r', '\n'];
const NUMERIC = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const VALID_HEX = [...NUMERIC, 'A', 'B', 'C', 'D', 'E', 'F', 'a', 'b', 'c', 'd', 'e', 'f'];
const ESCAPABLE = ['"', '\\', '/', 'b', 'f', 'n', 'r', 't'];

class JSONValidator {
  input;

  pos = 0;

  char: string | null;

  constructor(input: string) {
    this.input = input;
    this.char = input.charAt(0);
  }

  validate() {
    X(this.eatWhitespace());
    Q(this.parseValue());
    if (this.pos < this.input.length) {
      return Throw.SyntaxError('Unexpected token in JSON');
    }
    return NormalCompletion(undefined);
  }

  advance() {
    this.pos += 1;
    if (this.pos === this.input.length) {
      this.char = null;
    } else if (this.pos > this.input.length) {
      return Throw.SyntaxError('Unexpected token in JSON');
    } else {
      this.char = this.input.charAt(this.pos);
    }
    return this.char;
  }

  eatWhitespace() {
    while (this.eat(WHITESPACE)) {
      // nothing
    }
  }

  eat(c: string | readonly string[]) {
    if (Array.isArray(c) && c.includes(this.char)) {
      X(this.advance());
      return true;
    } else if (this.char === c) {
      X(this.advance());
      return true;
    }
    return false;
  }

  expect(c: string | readonly string[]) {
    const { char } = this;
    if (!this.eat(c)) {
      return Throw.SyntaxError('Expected character $1 but got $2 in JSON', JSON.stringify(c), JSON.stringify(this.char || ''));
    }
    return char;
  }

  parseValue() {
    switch (this.char) {
      case '"':
        return Q(this.parseString());
      case '{':
        return Q(this.parseObject());
      case '[':
        return Q(this.parseArray());
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
      case '-':
        return Q(this.parseNumber());
      case 'f':
        X(this.expect('f'));
        Q(this.expect('a'));
        Q(this.expect('l'));
        Q(this.expect('s'));
        Q(this.expect('e'));
        return X(this.eatWhitespace());
      case 't':
        X(this.expect('t'));
        Q(this.expect('r'));
        Q(this.expect('u'));
        Q(this.expect('e'));
        return X(this.eatWhitespace());
      case 'n':
        X(this.expect('n'));
        Q(this.expect('u'));
        Q(this.expect('l'));
        Q(this.expect('l'));
        return X(this.eatWhitespace());
      default:
        return Throw.SyntaxError('Unexpected character $1 in JSON', JSON.stringify(this.char));
    }
  }

  parseString() {
    Q(this.expect('"'));
    while (!this.eat('"')) {
      if (this.eat('\\')) {
        if (!this.eat(ESCAPABLE)) {
          Q(this.expect('u'));
          Q(this.expect(VALID_HEX));
          Q(this.expect(VALID_HEX));
          Q(this.expect(VALID_HEX));
          Q(this.expect(VALID_HEX));
        }
      } else {
        if (this.char! < ' ') {
          return Throw.SyntaxError('Unexpected character $1 in JSON', JSON.stringify(this.char));
        }
        Q(this.advance());
      }
    }
    return X(this.eatWhitespace());
  }

  parseNumber(): PlainCompletion<void> {
    this.eat('-');
    if (!this.eat('0')) {
      Q(this.expect(NUMERIC));
      while (this.eat(NUMERIC)) {
        // nothing
      }
    }
    if (this.eat('.')) {
      Q(this.expect(NUMERIC));
      while (this.eat(NUMERIC)) {
        // nothing
      }
    }
    if (this.eat(['e', 'E'])) {
      this.eat(['-', '+']);
      Q(this.expect(NUMERIC));
      while (this.eat(NUMERIC)) {
        // nothing
      }
    }
    X(this.eatWhitespace());
  }

  parseObject(): PlainCompletion<void> {
    Q(this.expect('{'));
    X(this.eatWhitespace());
    let first = true;
    while (!this.eat('}')) {
      if (first) {
        first = false;
      } else {
        Q(this.expect(','));
        X(this.eatWhitespace());
      }
      Q(this.parseString());
      X(this.eatWhitespace());
      Q(this.expect(':'));
      X(this.eatWhitespace());
      Q(this.parseValue());
      X(this.eatWhitespace());
    }
    X(this.eatWhitespace());
  }

  parseArray(): PlainCompletion<void> {
    Q(this.expect('['));
    X(this.eatWhitespace());
    let first = true;
    while (!this.eat(']')) {
      if (first) {
        first = false;
      } else {
        Q(this.expect(','));
        X(this.eatWhitespace());
      }
      Q(this.parseValue());
      X(this.eatWhitespace());
    }
    X(this.eatWhitespace());
  }

  static validate(input: string) {
    const v = new JSONValidator(input);
    return v.validate();
  }
}

/** https://tc39.es/ecma262/#sec-json-parse-record */
interface JSONParseRecord {
  readonly ParseNode: ParseNode;
  readonly Key: PropertyKeyValue;
  readonly Value: Value;
  readonly Elements: readonly JSONParseRecord[];
  readonly Entries: readonly JSONParseRecord[];
}

/** https://tc39.es/ecma262/#sec-internalizejsonproperty */
function* InternalizeJSONProperty(holder: ObjectValue, name: string, reviver: Value, parseRecord: JSONParseRecord | undefined): ValueEvaluator {
  const val = Q(yield* Get(holder, name));
  const context = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  let elementRecords: readonly JSONParseRecord[];
  let entryRecords: readonly JSONParseRecord[];
  if (parseRecord && SameValue(parseRecord.Value, val)) {
    if (!(val instanceof ObjectValue)) {
      const parseNode = parseRecord.ParseNode;
      Assert(parseNode.type !== 'ArrayLiteral' && parseNode.type !== 'ObjectLiteral');
      const sourceText = parseNode.sourceText;
      X(CreateDataPropertyOrThrow(context, 'source', Value(CodePointsToString(sourceText))));
    }
    elementRecords = parseRecord.Elements;
    entryRecords = parseRecord.Entries;
  } else {
    elementRecords = [];
    entryRecords = [];
  }
  if (val instanceof ObjectValue) {
    const isArray = Q(IsArray(val));
    if (isArray) {
      // Let _elementRecordsLen_ be the number of elements in _elementRecords_.
      const elementRecordsLen = elementRecords.length;
      const len = Q(yield* LengthOfArrayLike(val));
      let index = 0;
      while (index < len) {
        const prop = X(ToString(F(index)));
        const elementRecord = index < elementRecordsLen ? elementRecords[index] : undefined;
        const newElement = Q(yield* InternalizeJSONProperty(val, prop, reviver, elementRecord));
        if (newElement instanceof UndefinedValue) {
          Q(yield* val.Delete(prop));
        } else {
          Q(yield* CreateDataProperty(val, prop, newElement));
        }
        index += 1;
      }
    } else {
      const keys = Q(yield* EnumerableOwnProperties(val, 'key'));
      for (const P of keys) {
        const entryRecord = entryRecords.find((record) => SameValue(record.Key, P));
        const newElement = Q(yield* InternalizeJSONProperty(val, P.stringValue(), reviver, entryRecord));
        if (newElement instanceof UndefinedValue) {
          Q(yield* val.Delete(P));
        } else {
          Q(yield* CreateDataProperty(val, P, newElement));
        }
      }
    }
  }
  return Q(yield* Call(reviver, holder, [Value(name), val, context]));
}

/** https://tc39.es/ecma262/#sec-createjsonparserecord */
function CreateJSONParseRecord(parseNode: ParseNode, key: PropertyKeyValue, val: Value): JSONParseRecord {
  const typedValNode = ShallowestContainedJSONValue(parseNode);
  Assert(!!typedValNode);
  const elements = [];
  const entries = [];
  if (val instanceof ObjectValue) {
    const isArray = X(IsArray(val));
    if (isArray) {
      Assert(typedValNode.type === 'ArrayLiteral');
      const contentNodes = ArrayLiteralContentNodes(typedValNode);
      const len = contentNodes.length;
      const valLen = X(LengthOfArrayLike(val));
      Assert(valLen === len);
      let index = 0;
      while (index < len) {
        const propName = X(ToString(F(index)));
        const elementParseRecord = CreateJSONParseRecord(contentNodes[index], Value(propName), X(Get(val, propName)));
        elements.push(elementParseRecord);
        index += 1;
      }
    } else {
      Assert(typedValNode.type === 'ObjectLiteral');
      const propertyNodes = PropertyDefinitionNodes(typedValNode);
      const keys = X(EnumerableOwnProperties(val, 'key'));
      for (const P of keys) {
        let propertyDefinition: ParseNode;
        for (const propertyNode of propertyNodes) {
          const propName = PropName(propertyNode);
          if (propName === P.stringValue()) {
            propertyDefinition = propertyNode;
          }
        }
        Assert(!!(propertyDefinition!.type === 'PropertyDefinition' && propertyDefinition.PropertyName && propertyDefinition.AssignmentExpression));
        const propertyValueNode = propertyDefinition.AssignmentExpression;
        const entryParseRecord = CreateJSONParseRecord(propertyValueNode, P, X(Get(val, P)));
        entries.push(entryParseRecord);
      }
    }
  } else {
    Assert(typedValNode.type !== 'ArrayLiteral' && typedValNode.type !== 'ObjectLiteral');
  }
  return {
    ParseNode: typedValNode, Key: key, Value: val, Elements: elements, Entries: entries,
  };
}

export function ParseJSON(text: string): PlainCompletion<{ ParseNode: ParseNode, Value: Value }> {
  // 1. If StringToCodePoints(text) is not a valid JSON text as specified in ECMA-404, throw a SyntaxError exception.
  Q(JSONValidator.validate(text));
  const scriptString = `(${text});`;
  const script = ParseScript(scriptString, surroundingAgent.currentRealmRecord, { [kInternal]: { json: true } });
  Assert(!isArray(script)); // array means parse error
  const result = X(ScriptEvaluation(script));
  Assert(result instanceof JSStringValue || result instanceof NumberValue || result instanceof BooleanValue || result instanceof ObjectValue || result === Value.null);
  return { ParseNode: script.ECMAScriptCode, Value: result };
}

/** https://tc39.es/ecma262/#sec-json.parse */
function* JSON_parse([text = Value.undefined, reviver = Value.undefined]: Arguments): ValueEvaluator {
  const jsonString = Q(yield* ToString(text));
  const parseResult = Q(ParseJSON(jsonString));
  const unfiltered = parseResult.Value;
  Assert(unfiltered instanceof JSStringValue
    || unfiltered instanceof NumberValue
    || unfiltered instanceof BooleanValue
    || unfiltered instanceof NullValue
    || unfiltered instanceof ObjectValue);
  if (IsCallable(reviver)) {
    const root = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
    const rootName = '';
    X(CreateDataPropertyOrThrow(root, rootName, unfiltered));
    const snapshot = CreateJSONParseRecord(parseResult.ParseNode, Value(rootName), unfiltered);
    return Q(yield* InternalizeJSONProperty(root, rootName, reviver, snapshot));
  } else {
    return unfiltered;
  }
}

const codeUnitTable = new Map([
  [0x0008, '\\b'],
  [0x0009, '\\t'],
  [0x000A, '\\n'],
  [0x000C, '\\f'],
  [0x000D, '\\r'],
  [0x0022, '\\"'],
  [0x005C, '\\\\'],
]);

interface State {
  ReplacerFunction: ObjectValue | undefined;
  Stack: ObjectValue[];
  Indent: string;
  Gap: string;
  PropertyList: Set<string> | undefined;
}
/** https://tc39.es/ecma262/#sec-serializejsonproperty */
function* SerializeJSONProperty(state: State, key: JSStringValue, holder: ObjectValue): ValueEvaluator<JSStringValue | UndefinedValue> {
  let value = Q(yield* Get(holder, key)); // eslint-disable-line no-shadow
  if (value instanceof ObjectValue || value instanceof BigIntValue) {
      const toJSON = Q(yield* GetV(value, 'toJSON'));
    if (IsCallable(toJSON)) {
      value = Q(yield* Call(toJSON, value, [key]));
    }
  }
  if (state.ReplacerFunction !== undefined) {
    value = Q(yield* Call(state.ReplacerFunction, holder, [key, value]));
  }
  if (value instanceof ObjectValue) {
    if ('IsRawJSON' in value) {
      return X(Get(value, 'rawJSON')) as JSStringValue;
    }
    if ('NumberData' in value) {
      value = Q(yield* ToNumber(value));
    } else if ('StringData' in value) {
      value = Value(Q(yield* ToString(value)));
    } else if (isBooleanObject(value)) {
      value = Value(value.BooleanData);
    } else if (isBigIntObject(value)) {
      value = Value(value.BigIntData);
    }
  }
  if (value === Value.null) {
    return Value('null');
  }
  if (value === Value.true) {
    return Value('true');
  }
  if (value === Value.false) {
    return Value('false');
  }
  if (value instanceof JSStringValue) {
    return Value(QuoteJSONString(value.stringValue()));
  }
  if (value instanceof NumberValue) {
    if (value.isFinite()) {
      return Value(X(ToString(value)));
    }
    return Value('null');
  }
  if (value instanceof BigIntValue) {
    return Throw.TypeError('Cannot serialize a BigInt to JSON');
  }
  if (value instanceof ObjectValue && !IsCallable(value)) {
    const isArray = Q(IsArray(value));
    if (isArray) {
      return Q(yield* SerializeJSONArray(state, value));
    }
    return Q(yield* SerializeJSONObject(state, value));
  }
  return Value.undefined;
}

export function UnicodeEscape(codeUnit: string) {
  const n = codeUnit.charCodeAt(0);
  Assert(n < 0xFFFF);
  return `\u005Cu${n.toString(16).padStart(4, '0')}`;
}

/** https://tc39.es/ecma262/#sec-quotejsonstring */
function QuoteJSONString(value: string) { // eslint-disable-line no-shadow
  let product = '\u0022';
  const cpList = [...value].map((c) => c.codePointAt(0)!);
  for (const C of cpList) {
    if (codeUnitTable.has(C)) {
      product = `${product}${codeUnitTable.get(C)}`;
    } else if (C < 0x0020 || isLeadingSurrogate(C) || isTrailingSurrogate(C)) {
      const unit = String.fromCodePoint(C);
      product += UnicodeEscape(unit);
    } else {
      product += UTF16EncodeCodePoint(C as CodePoint);
    }
  }
  product = `${product}\u0022`;
  return product;
}

/** https://tc39.es/ecma262/#sec-serializejsonobject */
function* SerializeJSONObject(state: State, value: ObjectValue): ValueEvaluator<JSStringValue> {
  if (state.Stack.includes(value)) {
    return Throw.TypeError('Cannot JSON stringify a circular structure');
  }
  state.Stack.push(value);
  const stepback = state.Indent;
  state.Indent = `${state.Indent}${state.Gap}`;
  let K: IterableIterator<string | JSStringValue>;
  if (state.PropertyList !== undefined) {
    K = state.PropertyList.keys();
  } else {
    K = Q(yield* EnumerableOwnProperties(value, 'key')).values();
  }
  const partial = [];
  for (const propertyKey of K) {
    const P = typeof propertyKey === 'string' ? Value(propertyKey) : propertyKey;
    const strP = Q(yield* SerializeJSONProperty(state, P, value));
    if (!(strP instanceof UndefinedValue)) {
      let member = QuoteJSONString(P.stringValue());
      member = `${member}:`;
      if (state.Gap !== '') {
        member = `${member} `;
      }
      member = `${member}${strP.stringValue()}`;
      partial.push(member);
    }
  }
  let final;
  if (partial.length === 0) {
    final = Value('{}');
  } else {
    if (state.Gap === '') {
      const properties = partial.join(',');
      final = Value(`{${properties}}`);
    } else {
      const separator = `,\u000A${state.Indent}`;
      const properties = partial.join(separator);
      final = Value(`{\u000A${state.Indent}${properties}\u000A${stepback}}`);
    }
  }
  state.Stack.pop();
  state.Indent = stepback;
  return final;
}

/** https://tc39.es/ecma262/#sec-serializejsonarray */
function* SerializeJSONArray(state: State, value: ObjectValue): PlainEvaluator<JSStringValue | ThrowCompletion> {
  if (state.Stack.includes(value)) {
    return Throw.TypeError('Cannot JSON stringify a circular structure');
  }
  state.Stack.push(value);
  const stepback = state.Indent;
  state.Indent = `${state.Indent}${state.Gap}`;
  const partial = [];
  const len = Q(yield* LengthOfArrayLike(value));
  let index = 0;
  while (index < len) {
    const indexStr = X(ToString(F(index)));
    const strP = Q(yield* SerializeJSONProperty(state, Value(indexStr), value));
    if (strP instanceof UndefinedValue) {
      partial.push('null');
    } else {
      partial.push(strP.stringValue());
    }
    index += 1;
  }
  let final;
  if (partial.length === 0) {
    final = Value('[]');
  } else {
    if (state.Gap === '') {
      const properties = partial.join(',');
      final = Value(`[${properties}]`);
    } else {
      const separator = `,\u000A${state.Indent}`;
      const properties = partial.join(separator);
      final = Value(`[\u000A${state.Indent}${properties}\u000A${stepback}]`);
    }
  }
  state.Stack.pop();
  state.Indent = stepback;
  return final;
}

/** https://tc39.es/ecma262/#sec-json.stringify */
function* JSON_stringify([value = Value.undefined, replacer = Value.undefined, _space = Value.undefined]: Arguments): ValueEvaluator {
  const stack: ObjectValue[] = [];
  const indent = '';
  let PropertyList: Set<string> | undefined;
  let ReplacerFunction: ObjectValue | undefined;
  if (replacer instanceof ObjectValue) {
    if (IsCallable(replacer)) {
      ReplacerFunction = replacer;
    } else {
      const isArray = Q(IsArray(replacer));
      if (isArray) {
        PropertyList = new Set();
        const len = Q(yield* LengthOfArrayLike(replacer));
        let k = 0;
        while (k < len) {
          const vStr = X(ToString(F(k)));
          const v = Q(yield* Get(replacer, vStr));
          let item: string | undefined = undefined;
          if (v instanceof JSStringValue) {
            item = v.stringValue();
          } else if (v instanceof NumberValue) {
            item = X(ToString(v));
          } else if (v instanceof ObjectValue) {
            if ('StringData' in v || 'NumberData' in v) {
              item = Q(yield* ToString(v));
            }
          }
          if (item !== undefined && !PropertyList.has(item)) {
            PropertyList.add(item);
          }
          k += 1;
        }
      }
    }
  }
  let space: string | number;
  if (_space instanceof ObjectValue) {
    if ('NumberData' in _space) {
      _space = Q(yield* ToNumber(_space));
    } else if ('StringData' in _space) {
      space = Q(yield* ToString(_space));
    }
  } else if (_space instanceof JSStringValue) {
    space = _space.stringValue();
  }
  let gap: string;
  if (_space instanceof NumberValue) {
    space = Math.min(10, X(ToIntegerOrInfinity(_space)));
    if (space < 1) {
      gap = '';
    } else {
      gap = ' '.repeat(space);
    }
  } else if (typeof space! === 'string') {
    if (space.length <= 10) {
      gap = space;
    } else {
      gap = space.slice(0, 10);
    }
  } else {
    gap = '';
  }
  const wrapper = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  X(CreateDataPropertyOrThrow(wrapper, '', value));
  const state: State = {
    ReplacerFunction, Stack: stack, Indent: indent, Gap: gap, PropertyList,
  };
  return Q(yield* SerializeJSONProperty(state, Value(''), wrapper));
}

/** https://tc39.es/ecma262/#sec-json.rawjson */
function* JSON_rawJSON([text = Value.undefined]: Arguments): ValueEvaluator {
  const jsonString = Q(yield* ToString(text));
  const str = jsonString;
  if (str === '') {
    return Throw.SyntaxError('Unexpected token in JSON');
  }
  const forbiddenChar = ['\u0009', '\u000A', '\u000D', '\u0020', '\u005B', '\u007B'];
  if (forbiddenChar.includes(str[0]) || forbiddenChar.includes(str[str.length - 1])) {
    return Throw.SyntaxError('Unexpected token in JSON');
  }
  const parseResult = Q(ParseJSON(jsonString));
  const value = parseResult.Value;
  Assert(value instanceof JSStringValue || value instanceof NumberValue || value instanceof BooleanValue || value === Value.null);
  {
    const firstCodeUnit = str[0].charCodeAt(0);
    Assert(
      (firstCodeUnit >= 0x0061 && firstCodeUnit <= 0x007A)
      || (firstCodeUnit >= 0x0030 && firstCodeUnit <= 0x0039)
      || firstCodeUnit === 0x0022
      || firstCodeUnit === 0x002D,
    );
  }
  {
    const lastCodeUnit = str[str.length - 1].charCodeAt(0);
    Assert(
      (lastCodeUnit >= 0x0061 && lastCodeUnit <= 0x007A)
      || (lastCodeUnit >= 0x0030 && lastCodeUnit <= 0x0039)
      || lastCodeUnit === 0x0022,
    );
  }
  const obj = OrdinaryObjectCreate(Value.null, ['IsRawJSON']);
  X(CreateDataPropertyOrThrow(obj, 'rawJSON', Value(jsonString)));
  X(SetIntegrityLevel(obj, 'frozen'));
  return obj;
}

/** https://tc39.es/ecma262/#sec-json.israwjson */
function JSON_isRawJSON([value = Value.undefined]: Arguments) {
  if (value instanceof ObjectValue && 'IsRawJSON' in value) {
    return Value.true;
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-static-semantics-shallowestcontainedjsonvalue */
function ShallowestContainedJSONValue(root: ParseNode): ParseNode | undefined {
  const F = surroundingAgent.activeFunctionObject;
  Assert((F as BuiltinFunctionObject).nativeFunction === JSON_parse);
  const types: ParseNode['type'][] = [
    'NullLiteral', 'BooleanLiteral', 'NumericLiteral', 'StringLiteral', 'ArrayLiteral', 'ObjectLiteral', 'UnaryExpression',
  ];
  let unaryExpression: ParseNode | undefined;
  let queue = [root];
  while (queue.length > 0) {
    const candidate = queue.shift()!;
    let queuedChildren = false;
    for (const type of types) {
      if (candidate?.type === type) {
        if (type === 'UnaryExpression') {
          unaryExpression = candidate;
        } else if (type === 'NumericLiteral') {
          // skip Assert: candidate is contained within unaryExpression
          // our AST is different from the spec's AST
          // Return unaryExpression.
          return unaryExpression || candidate;
        } else {
          return candidate;
        }
      }
      const children = [...avoid_using_children(candidate)];
      if (!queuedChildren && children.length && Contains(candidate, type)) {
        queue = queue.concat(children);
        queuedChildren = true;
      }
    }
  }
  return undefined;
}

export function bootstrapJSON(realmRec: Realm) {
  const json = bootstrapPrototype(realmRec, [
    ['parse', JSON_parse, 2],
    ['stringify', JSON_stringify, 3],
    ['rawJSON', JSON_rawJSON, 1],
    ['isRawJSON', JSON_isRawJSON, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'JSON');

  realmRec.Intrinsics['%JSON%'] = json;
  realmRec.Intrinsics['%JSON.parse%'] = X(Get(json, 'parse')) as FunctionObject;
  realmRec.Intrinsics['%JSON.stringify%'] = X(Get(json, 'stringify')) as FunctionObject;
}
