import {
  JSStringValue,
  ObjectValue,
  Value,
  type Arguments,
  type FunctionCallContext,
  type UndefinedValue,
} from '../value.mts';
import { Q, X, type ValueEvaluator } from '../completion.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { isErrorObject } from './Error.mts';
import {
  surroundingAgent,
} from '#self';
import {
  Assert,
  Get,
  SetterThatIgnoresPrototypeProperties,
  ToString,
  type BuiltinFunctionObject,
  Realm,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-error.prototype.tostring */
function* ErrorProto_toString(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<JSStringValue> {
  // 1. Let O be this value.
  const O = thisValue;
  // 2. If Type(O) is not Object, throw a TypeError exception.
  if (!(O instanceof ObjectValue)) {
    return Throw.TypeError('this value $1 is not an object', O);
  }
  // 3. Let name be ? Get(O, "name").
  const _name = Q(yield* Get(O, 'name'));
  let name: string;
  // 4. If name is undefined, set name to "Error"; otherwise set name to ? ToString(name).
  if (_name === Value.undefined) {
    name = 'Error';
  } else {
    name = Q(yield* ToString(_name));
  }
  // 5. Let msg be ? Get(O, "message").
  const _msg = Q(yield* Get(O, 'message'));
  let msg: string;
  // 6. If msg is undefined, set msg to the empty String; otherwise set msg to ? ToString(msg).
  if (_msg === Value.undefined) {
    msg = '';
  } else {
    msg = Q(yield* ToString(_msg));
  }
  // 7. If name is the empty String, return msg.
  if (name === '') {
    return Value(msg);
  }
  // 8. If msg is the empty String, return name.
  if (msg === '') {
    return Value(name);
  }
  // 9. Return the string-concatenation of name, the code unit 0x003A (COLON), the code unit 0x0020 (SPACE), and msg.
  return Value(`${name}: ${msg}`);
}

/** https://tc39.es/proposal-error-stack-accessor/#sec-get-error.prototype.stack */
function* ErrorProto_stack_getter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<JSStringValue | UndefinedValue> {
  const error = thisValue;
  if (!(error instanceof ObjectValue)) {
    return Throw.TypeError('this value $1 is not an object', error);
  }
  if (!isErrorObject(error)) {
    return Value.undefined;
  }
  // 4. Return an implementation-defined string that represents the stack trace of error.
  Assert(typeof error.HostDefinedFormattedStack === 'string');
  return Value(error.HostDefinedMessageString + error.HostDefinedFormattedStack);
}

/** https://tc39.es/proposal-error-stack-accessor/#sec-set-error.prototype.stack */
function* ErrorProto_stack_setter(args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator<UndefinedValue> {
  const [value = Value.undefined] = args;

  const error = thisValue;
  if (!(error instanceof ObjectValue)) {
    return Throw.TypeError('this value $1 is not an object', error);
  }
  if (!(value instanceof JSStringValue)) {
    return Throw.TypeError('stack property must be set to a string value, but got $1', value);
  }
  Q(yield* SetterThatIgnoresPrototypeProperties(thisValue, surroundingAgent.intrinsic('%Error.prototype%'), Value('stack'), value));
  return Value.undefined;
}

export function bootstrapErrorPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['toString', ErrorProto_toString, 0],
    ['message', Value('')],
    ['name', Value('Error')],
    ['stack', [ErrorProto_stack_getter, ErrorProto_stack_setter]],
  ], realmRec.Intrinsics['%Object.prototype%']);

  realmRec.Intrinsics['%Error.prototype%'] = proto;
  realmRec.Intrinsics['%Error.prototype.toString%'] = X(Get(proto, 'toString')) as BuiltinFunctionObject;
}
