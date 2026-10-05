import { isArray, OutOfRange } from '../utils/language.mts';
import { R } from '../abstract-ops/all.mjs';
import { isBooleanObject } from '../intrinsics/Boolean.mts';
import { isNumberObject } from '../intrinsics/Number.mts';
import { isBigIntObject } from '../intrinsics/BigInt.mts';
import { isStringObject } from '../intrinsics/String.mts';
import { isSymbolObject } from '../intrinsics/Symbol.mts';
import {
  BigIntValue,
  BooleanValue,
  Construct, CreateArrayFromList, EscapeRegExpPattern, isArrayBufferObject, isArrayExoticObject, isDateObject, isErrorObject, isFunctionObject, isModuleNamespaceObject, isPromiseObject, isRegExpObject, isTypedArrayObject, JSStringValue, NullValue, NumberValue, ObjectValue, PrivateName, surroundingAgent, SymbolValue, ThrowCompletion, UndefinedValue, Value, X,
  type Intrinsics, type ErrorObject,
} from '#self';

/** https://tc39.es/ecma262/#sec-throw-an-exception */
export function Throw(_: never): never
/** @internal */
export function Throw(_: Value): never
export function Throw(_: Value): never {
  throw new Error('Throw requires build.');
}

function ThrowFactory(intrinsicName: keyof Intrinsics & `%${string}Error%`): Throw {
  return (message: string, ...args: readonly Formattable[]) => {
    message.matchAll(/(\$(\d+))/g);
    let lastIndex = 0;
    let formattedMessage = '';
    const unformattedMessage: (string | Value)[] = [];
    for (const match of message.matchAll(/(\$(\d+))/g)) {
      const index = Number(match[2]) - 1;
      if (index < 0) {
        throw new RangeError('We count from $1 ha ha');
      }
      if (index < 0 || index >= args.length) {
        throw new RangeError('Insufficient arguments for format string');
      }
      const arg = args[index];
      if (arg === undefined) {
        throw new RangeError(`Argument for ${match[0]} is undefined in message '${message}'`);
      }
      formattedMessage += message.slice(lastIndex, match.index) + format(arg);
      unformattedMessage.push(message.slice(lastIndex, match.index), toDisplayableValue(arg));
      lastIndex = match.index + match[0].length;
    }
    formattedMessage += message.slice(lastIndex);
    unformattedMessage.push(message.slice(lastIndex));
    if (unformattedMessage[0] === '') unformattedMessage.shift();
    if (unformattedMessage.at(-1) === '') unformattedMessage.pop();

    let E: ErrorObject;
    if (intrinsicName === '%AggregateError%') {
      E = X(Construct(surroundingAgent.intrinsic(intrinsicName), [X(CreateArrayFromList([])), Value(formattedMessage)])) as ErrorObject;
    } else {
      E = X(Construct(surroundingAgent.intrinsic(intrinsicName), [Value(formattedMessage)])) as ErrorObject;
    }
    if (unformattedMessage.some((part) => typeof part !== 'string')) {
      E.HostDefinedMessage = unformattedMessage;
    }
    return ThrowCompletion(E);
  };
}
Throw.EvalError = ThrowFactory('%EvalError%');
Throw.RangeError = ThrowFactory('%RangeError%');
Throw.ReferenceError = ThrowFactory('%ReferenceError%');
Throw.SyntaxError = ThrowFactory('%SyntaxError%');
Throw.TypeError = ThrowFactory('%TypeError%');
Throw.URIError = ThrowFactory('%URIError%');
Throw.Error = ThrowFactory('%Error%');
Throw.AggregateError = ThrowFactory('%AggregateError%');

export type Formattable = string | number | bigint | Value | PrivateName | readonly Formattable[];

export function format(arg: Formattable): string {
  switch (true) {
    case typeof arg !== 'object':
      return String(arg);
    case arg instanceof PrivateName:
      return `#${arg.Description}`;
    case arg instanceof JSStringValue:
      return JSON.stringify(arg.stringValue());
    case arg instanceof NumberValue: {
      const n = R(arg);
      if (n === 0 && Object.is(n, -0)) {
        return '-0';
      }
      return n.toString();
    }
    case arg instanceof BigIntValue:
      return `${String(R(arg))}n`;
    case arg instanceof SymbolValue:
      return `Symbol(${arg.Description || ''})`;
    case arg instanceof NullValue:
      return 'null';
    case arg instanceof UndefinedValue:
      return 'undefined';
    case arg instanceof BooleanValue:
      return String(arg.booleanValue());
    case arg instanceof ObjectValue: {
      if (isPromiseObject(arg)) {
        return '[object Promise]';
      }
      if (isModuleNamespaceObject(arg)) {
        return '[object Module]';
      }
      if (isFunctionObject(arg)) {
        const name = arg.properties.get('name');
        if (name && name.Value instanceof JSStringValue && name.Value.stringValue() !== '') {
          return `[Function ${name.Value.stringValue()}]`;
        }
        return '[Function]';
      }
      if (isErrorObject(arg)) {
        return '[object Error]';
      }
      if (isRegExpObject(arg)) {
        const P = EscapeRegExpPattern(arg.OriginalSource, arg.OriginalFlags);
        const F = arg.OriginalFlags;
        return `/${P}/${F}`;
      }
      if (isDateObject(arg)) {
        const d = new Date(arg.DateValue);
        if (Number.isNaN(d.getTime())) {
          return '[Date Invalid]';
        }
        return `[Date ${d.toISOString()}]`;
      }
      if (isBooleanObject(arg)) {
        return `[Boolean ${arg.BooleanData}]`;
      }
      if (isNumberObject(arg)) {
        return `[Number ${arg.NumberData}]`;
      }
      if (isBigIntObject(arg)) {
        return `[BigInt ${arg.BigIntData}]`;
      }
      if (isStringObject(arg)) {
        return `[String ${arg.StringData}]`;
      }
      if (isSymbolObject(arg)) {
        return `[Symbol ${arg.SymbolData}]`;
      }
      if (isArrayExoticObject(arg)) {
        return '[object Array]';
      }
      if (isTypedArrayObject(arg)) {
        return `[object ${arg.TypedArrayName}]`;
      }
      if (isArrayBufferObject(arg)) {
        return '[object ArrayBuffer]';
      }
      return '[object Object]';
    }
    case isArray(arg):
      return `[${arg.map(format).join(', ')}]`;
    default:
      throw OutOfRange.exhaustive(arg);
  }
}

function toDisplayableValue(arg: Formattable): Value | string {
  switch (true) {
    case typeof arg === 'string':
      return arg;
    case typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'bigint':
      return Value(arg);
    case arg instanceof Value:
      return arg;
    case arg instanceof PrivateName:
      return Value(`#${arg.Description}`);
    case isArray(arg):
      return CreateArrayFromList(arg.map((value) => {
        const v = toDisplayableValue(value);
        return v instanceof Value ? v : Value(v);
      }));
    default:
      throw OutOfRange.exhaustive(arg);
  }
}

export interface Throw {
  // auto-generate start
  (m:
'"arguments" cannot be used as an identifier in class static block'
  | '"day" is required'
  | '"month-code" or "month" is required'
  | '"year" is required'
  | "'getPrototypeOf' on proxy: proxy target is non-extensible but the trap did not return its actual prototype"
  | "'getPrototypeOf' on proxy: trap returned neither object nor null"
  | "'ownKeys' on proxy: trap result returned extra keys but proxy target is non-extensible"
  | "'ownKeys' on proxy: trap returned duplicate entries"
  | "'preventExtensions' on proxy: trap returned truthy but the proxy target is extensible"
  | "'setPrototypeOf' on proxy: trap returned truthy for setting a new prototype on the non-extensible proxy target"
  | 'A class cannot have static and instance private methods with the same name'
  | 'A class element cannot be named as "constructor"'
  | 'A class element cannot be named as "prototype" or "constructor"'
  | 'A class static field cannot be named as "constructor"'
  | 'AbstractModuleSource cannot be constructed'
  | 'Array length must be uint32.'
  | 'Array length too big.'
  | 'ArrayBuffer cannot be invoked without new'
  | 'AsyncDisposableStack cannot be invoked without new'
  | 'Attempt to access detached ArrayBuffer'
  | 'Attempt to access shared ArrayBuffer'
  | 'BigInt has no unsigned right shift, use >> instead'
  | 'BigInt is not a constructor'
  | 'BigInt literal cannot have leading zero'
  | 'Calendar annotation is not allowed when day is absent'
  | 'Calendar annotation is not allowed when year is absent'
  | 'Calendars are not equal'
  | 'Cannot JSON stringify a circular structure'
  | 'Cannot add a date to an instant'
  | 'Cannot allocate memory'
  | 'Cannot call addInitializer after decoration is finished'
  | 'Cannot convert object to primitive value'
  | 'Cannot define private element to a non-extensible object'
  | 'Cannot delete a super property'
  | 'Cannot delete an identifier in strict mode'
  | 'Cannot delete private names'
  | 'Cannot divide by zero'
  | 'Cannot make length of array-like object surpass the bounds of an integer index'
  | 'Cannot mix BigInt and other types, use explicit conversions'
  | 'Cannot mix logical operator with ?? operator. Add parentheses to determine precedence.'
  | 'Cannot reduce an empty array with no initial value'
  | 'Cannot resize ArrayBuffer to bigger than maxByteLength'
  | 'Cannot serialize a BigInt to JSON'
  | 'Cannot transfer ArrayBuffer with custom detach key'
  | 'Class missing binding identifier'
  | 'Could not set prototype of object'
  | 'Critical calendar annotation failed.'
  | 'DataView cannot be invoked without new'
  | 'Date value is not an integral number'
  | 'DateTime outside of range'
  | 'Decorators can only be used to decorate classes'
  | 'Decorators cannot appear on both sides of the export keyword'
  | 'Default export already declared'
  | 'Derived TypedArray constructor created an array which was too small'
  | 'Duplicate __proto__ property'
  | 'Duplicate constructor'
  | 'Exponent of bigint must be positive'
  | 'Filtered namespace exports cannot contain aliased export specifiers'
  | 'Filtered namespace exports must be followed by `from`'
  | 'Filtered namespace imports cannot contain aliased or string import specifiers'
  | 'Filtered namespace imports cannot contain duplicate names'
  | 'FinalizationRegistry cannot be invoked without new'
  | 'For-await syntax is only valid with for-of loops'
  | 'For-in/of loop declarations cannot bind "let"'
  | 'Host does not set a module loader'
  | 'ISODate is out of range'
  | 'Identifier has already been declared'
  | 'Illegal octal escape'
  | 'Import name cannot be "eval" or "arguments"'
  | 'Import name cannot be a keyword'
  | 'Import name cannot be a string'
  | 'Initializers are not allowed in for-in/of loop declarations'
  | 'Invalid ForDeclaration binding initialization'
  | 'Invalid Unicode escape'
  | 'Invalid alphabet'
  | 'Invalid assignment in rest element'
  | 'Invalid assignment target'
  | 'Invalid base64 string'
  | 'Invalid call to ArrayBuffer.prototype.detached on shared ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.maxByteLength on shared ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.resizable on shared ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.resize on detached ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.resize on shared ArrayBuffer'
  | 'Invalid class range'
  | 'Invalid code point'
  | 'Invalid date'
  | 'Invalid decimal digits'
  | 'Invalid duration'
  | 'Invalid empty identifier'
  | 'Invalid hex digit'
  | 'Invalid hex string'
  | 'Invalid identifier escape'
  | 'Invalid identity escape'
  | 'Invalid lastChunkHandling'
  | 'Invalid leap month'
  | 'Invalid left-hand side in for-in/of statement'
  | 'Invalid length'
  | 'Invalid month'
  | 'Invalid normalization form'
  | 'Invalid receiver'
  | 'Invalid surrogate pair'
  | 'Invalid template escape'
  | 'Invalid time'
  | 'Invalid trailing surrogate'
  | 'Invalid unicode escape'
  | 'Invalid unicode property'
  | 'Invalid unicode property name'
  | 'Invalid unicode property name or value'
  | 'Invalid unicode property value'
  | 'Invalid use of arguments'
  | 'Invalid use of super'
  | 'Iterator cannot be invoked without new'
  | 'Iterator is an abstract class'
  | 'Iterator length is bigger than MAX_SAFE_INTEGER'
  | 'Iterator.zip mode must be one of "shortest", "longest", or "strict"'
  | 'Iterator.zip strict mode requires all iterators to end together'
  | 'Iterator.zipKeyed mode must be one of "shortest", "longest", or "strict"'
  | 'Legacy octal literal in strict mode'
  | 'Let in lexical binding'
  | 'Map cannot be invoked without new'
  | 'Mismatching month and month code'
  | 'Missing catch or finally clause in try statement'
  | 'Missing initializer in await using declaration'
  | 'Missing initializer in const declaration'
  | 'Missing initializer in using declaration'
  | 'Module export name contains invalid Unicode'
  | 'Module source is not available'
  | 'Multiple possible epoch nanoseconds'
  | 'Newline after throw statement'
  | "Newly created TypedArray did not match exemplar's content type"
  | 'No matching offset found for the given date and time'
  | 'No possible epoch nanoseconds'
  | 'No promises passed to Promise.any were fulfilled'
  | 'Non-simple parameter cannot be used with "use strict" directive'
  | 'Not a Uint8Array'
  | 'Not a hex digit'
  | 'Numbers out of order in quantifier'
  | 'Object is disposed'
  | 'Object prototype must be an Object or null'
  | 'Object prototype must be an object or null'
  | 'Offset is out of bound'
  | 'Offset is outside the bounds of the DataView'
  | 'Options parameter is required'
  | 'PlainDateTime outside of range'
  | 'PlainMonthDay out of range'
  | 'PlainYearMonth calendars do not match'
  | 'PlainYearMonth out of range'
  | 'PlusModifiers and MinusModifiers cannot be both empty.'
  | 'Promise cannot be invoked without new'
  | 'Promise reject function already set'
  | 'Promise resolve function already set'
  | 'Proxy cannot be invoked without new'
  | 'RegExp flags "v" and "u" cannot be used together'
  | 'Repeated modifiers in modifier group'
  | 'Rest element must be last element'
  | 'Rest property must be last property'
  | 'Resulting ISODate is out of range'
  | 'Resulting date-time is out of range'
  | 'Separator is not allowed after leading zero'
  | 'Set cannot be invoked without new'
  | 'ShadowRealm cannot be invoked without new'
  | 'Spread element must be last element'
  | 'String is too long'
  | 'Sum of start offset and byte length should be less than the size of underlying buffer'
  | "Super class's prototype must be an object or null"
  | 'Symbol is not a constructor'
  | 'Template in optional chain'
  | 'Temporal.Duration cannot be converted to primitive value. If you are comparing two Temporal.Duration objects with > or <, use Temporal.Duration.compare() instead.'
  | 'Temporal.Duration constructor cannot be called without new'
  | 'Temporal.Instant cannot be called without new'
  | 'Temporal.Instant cannot be converted to primitive value If you are comparing two Temporal.Duration objects with > or <, use Temporal.Instant.compare() instead.'
  | 'Temporal.PlainDate cannot be converted to primitive value. If you are comparing two Temporal.PlainDate objects with > or <, use Temporal.PlainDate.compare() instead.'
  | 'Temporal.PlainDate constructor cannot be called without new'
  | 'Temporal.PlainDateTime cannot be called without new'
  | 'Temporal.PlainDateTime cannot be converted to primitive value. If you are comparing two Temporal.PlainDateTime objects with > or <, use Temporal.PlainDateTime.compare() instead.'
  | 'Temporal.PlainMonthDay cannot be called without new'
  | 'Temporal.PlainMonthDay cannot be converted to primitive value. If you are comparing two Temporal.PlainMonthDay objects with > or <, use Temporal.PlainMonthDay.compare() instead.'
  | 'Temporal.PlainTime cannot be called without new'
  | 'Temporal.PlainTime cannot be converted to primitive value. If you are comparing two Temporal.PlainTime objects with > or <, use Temporal.PlainTime.compare() instead.'
  | 'Temporal.PlainYearMonth cannot be called without new'
  | 'Temporal.PlainYearMonth cannot be converted to primitive value. If you are comparing two Temporal.PlainYearMonth objects with > or <, use Temporal.PlainYearMonth.compare() instead.'
  | 'Temporal.ZonedDateTime cannot be called without new'
  | 'Temporal.ZonedDateTime cannot be converted to primitive value. If you are comparing two Temporal.ZonedDateTime objects with > or <, use Temporal.ZonedDateTime.compare() instead.'
  | 'The caller, callee, and arguments properties may not be accessed on functions or the arguments objects for calls to them'
  | 'The iterator is already complete.'
  | 'This class cannot be inverted'
  | 'Time zones are not equal'
  | 'Too many capturing groups'
  | 'TypedArray index out of bounds'
  | 'URI malformed'
  | 'Unexpected - in modifiers'
  | 'Unexpected end of CharacterClass'
  | 'Unexpected end of input'
  | 'Unexpected escape'
  | 'Unexpected token'
  | 'Unexpected token in JSON'
  | 'Unterminated comment'
  | 'Unterminated range'
  | 'Unterminated regular expression'
  | 'Unterminated string literal'
  | 'Unterminated template literal'
  | 'Using declarations are not allowed at the top level of a Script'
  | 'Using declarations are not allowed directly in switch clauses'
  | 'Using declarations are only allowed in for-of loop heads'
  | 'WeakMap cannot be invoked without new'
  | 'WeakRef cannot be invoked without new'
  | 'WeakSet cannot be invoked without new'
  | 'argument[0] must be a string'
  | 'argument[0] must be an ArrayBuffer'
  | 'arguments cannot be referenced in a class field initializer'
  | 'await cannot be used as an identifier inside async functions'
  | 'await cannot be used as an identifier inside async functions or modules'
  | 'await cannot be used as an identifier inside parameters of async functions'
  | 'await cannot be used in class static block'
  | 'await cannot be used in formal parameters'
  | 'await cannot be used inside parameters of arrow functions'
  | 'calendar is not a string'
  | 'direction option is required'
  | 'directionParam is required'
  | 'largestUnit must be larger than smallestUnit'
  | 'object.constructor[Symbol.species] is not a constructor'
  | 'offset is not a string'
  | 'relativeTo is required for calendar units'
  | 'relativeTo option is required when comparing durations with calendar units'
  | 'roundTo is required'
  | 'roundingIncrement must be 1 when rounding a date unit to a larger unit'
  | 'size property must be a positive integer'
  | 'size property must not be undefined, as it will be NaN'
  | 'smallestUnit and largestUnit cannot both be omitted'
  | 'smallestUnit cannot be auto'
  | 'smallestUnit cannot be hour'
  | 'smallestUnit cannot be hour or minute'
  | 'this has already been initialized'
  | 'this has not been initialized'
  | 'time-zone is required'
  | 'timeZone is not a string'
  | 'totalOf is required'
  | 'u and v cannot be used together'
  | 'unit cannot be auto'
  | 'with statement cannot be used in strict mode'
  | 'yield cannot be used as an identifier inside generator functions'
  | 'yield cannot be used as an identifier inside generator functions or modules'
  | 'yield cannot be used in formal parameters'
  | 'yield cannot be used inside parameters of arrow functions'
  ): ThrowCompletion;
  (m:
'$1 can only be used with v flag'
  | '$1 cannot be inverted'
  | '$1 cannot be invoked without new'
  | '$1 cannot be used as a WeakMap key'
  | '$1 cannot be used as an identifier'
  | '$1 cannot be used as an identifier in strict mode'
  | '$1 cannot be used as an index'
  | '$1 cannot be used before initialization'
  | '$1 cannot be weakly referenced'
  | '$1 does not look like a TemporalTimeLike object'
  | '$1 is already declared'
  | '$1 is not a Promise constructor'
  | '$1 is not a RegExp object'
  | '$1 is not a TemporalTimeLike object'
  | '$1 is not a constructor'
  | '$1 is not a finite number'
  | '$1 is not a function'
  | '$1 is not a number'
  | '$1 is not a partial Temporal object'
  | '$1 is not a string'
  | '$1 is not a supported calendar'
  | '$1 is not a valid array length'
  | '$1 is not a valid epoch nanoseconds'
  | '$1 is not a valid modifier'
  | '$1 is not a valid month code'
  | '$1 is not a valid property name'
  | '$1 is not a valid undersized mode'
  | '$1 is not an integer'
  | '$1 is not an integral Number'
  | '$1 is not an integral Number or infinity'
  | '$1 is not an object'
  | '$1 is not an object or a symbol'
  | '$1 is not defined'
  | '$1 is not iterable'
  | '$1 is not object or null'
  | '$1 is not the [[ArrayBufferDetachKey]] of the given ArrayBuffer'
  | '$1 is out of range'
  | '$1 is too large'
  | '$1 is too small'
  | "'defineProperty' on proxy: trap returned truthy for adding property $1 that is incompatible with the existing property in the proxy target"
  | "'defineProperty' on proxy: trap returned truthy for adding property $1 to the non-extensible proxy target"
  | "'defineProperty' on proxy: trap returned truthy for defining non-configurable property $1 which cannot be non-writable, unless there exists a corresponding non-configurable, non-writable own property of the target object"
  | "'defineProperty' on proxy: trap returned truthy for defining non-configurable property $1 which is either non-existent or configurable in the proxy target"
  | "'deleteProperty' on proxy: trap returned truthy for property $1 but the proxy target is non-extensible"
  | "'deleteProperty' on proxy: trap returned truthy for property $1 which is non-configurable in the proxy target"
  | "'get' on proxy: property $1 is a non-configurable accessor property on the proxy target and does not have a getter function, but the trap did not return 'undefined'"
  | "'get' on proxy: property $1 is a read-only and non-configurable data property on the proxy target but the proxy did not return its actual value"
  | "'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property $1 which is either non-existent or configurable in the proxy target"
  | "'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property $1 which is writable or configurable in the proxy target"
  | "'getOwnPropertyDescriptor' on proxy: trap returned descriptor for property $1 that is incompatible with the existing property in the proxy target"
  | "'getOwnPropertyDescriptor' on proxy: trap returned neither object nor undefined for property $1"
  | "'getOwnPropertyDescriptor' on proxy: trap returned undefined for property $1 which exists in the non-extensible target"
  | "'getOwnPropertyDescriptor' on proxy: trap returned undefined for property $1 which is non-configurable in the proxy target"
  | "'has' on proxy: trap returned falsy for property $1 but the proxy target is not extensible"
  | "'has' on proxy: trap returned falsy for property $1 which exists in the proxy target as non-configurable"
  | "'isExtensible' on proxy: trap result does not reflect extensibility of proxy target (which is $1)"
  | "'ownKeys' on proxy: trap result did not include $1"
  | "'set' on proxy: trap returned truthy for property $1 which exists in the proxy target as a non-configurable and non-writable accessor property without a setter"
  | "'set' on proxy: trap returned truthy for property $1 which exists in the proxy target as a non-configurable and non-writable data property with a different value"
  | 'Accessor decorator must return an object or undefined, but $1 was returned'
  | 'Assignment to constant variable $1'
  | 'Cannot convert $1 to Temporal.Duration'
  | 'Cannot convert $1 to TemporalPartialDurationRecord'
  | 'Cannot convert $1 to a BigInt'
  | 'Cannot convert $1 to object'
  | 'Cannot convert a Symbol value to a $1'
  | 'Cannot convert a symbol value $1 to a number'
  | 'Cannot create a ShadowRealm wrapped function on $1'
  | 'Cannot define property $1'
  | 'Cannot delete property $1'
  | 'Cannot load module $1'
  | 'Cannot manipulate a running generator $1'
  | 'Cannot mix BigInt and other types in $1 operation'
  | "Cannot perform '$1' on a proxy that has been revoked"
  | 'Cannot resolve a promise $1 with itself'
  | 'Class decorator must return a function or undefined, but $1 was returned'
  | 'Count $1 is invalid'
  | 'Critical annotation "$1" failed.'
  | 'Duplicate import attribute $1'
  | 'Duplicate regular expression flag "$1"'
  | 'Duplicated capture group $1'
  | 'Expect a CharacterClassEscape but $1 found'
  | "Expected 'this' value to be a function but got $1"
  | 'Expected a character but got $1'
  | 'Export identifier $1 already declared'
  | 'Field decorator must return a function or undefined, but $1 was returned'
  | 'First argument to $1 must not be a regular expression'
  | 'Function $1 already declared'
  | 'Identifier $1 already declared'
  | 'Import attribute value must be a string, but $1'
  | 'Index $1 is too big'
  | 'Invalid TemporalUnit value $1'
  | 'Invalid code point $1'
  | 'Invalid format range for $1'
  | 'Invalid hint: $1'
  | 'Invalid temporal unit value $1'
  | 'Invalid time string $1'
  | 'Invalid time zone identifier: $1'
  | 'Label $1 not found'
  | 'Method decorator must return a function or undefined, but $1 was returned'
  | 'Module "$1" is not ready for synchronous execution'
  | 'Module undefined export $1'
  | 'No module loader can load this module request.$1'
  | 'Only primitive values and functions can be passed across the ShadowRealm boundary, but $1 is an object'
  | 'Private field $1 is not a getter'
  | 'Private field $1 is not a setter'
  | 'Private identifier $1 already declared'
  | 'Private identifier $1 not defined'
  | 'Private method $1 cannot be set'
  | 'Promise reject function $1 is not callable'
  | 'Promise resolve function $1 is not callable'
  | 'Property descriptors must not specify both accessors and a value or writable attribute, but $1 does'
  | 'RegExp flags must not have duplicates ($1)'
  | 'RegExp has invalid flags ($1)'
  | 'Return value $1 of a derived constructor is not an object or undefined'
  | 'Right-hand side of "in" ($1) is not an object'
  | 'Right-hand side of "instanceof" ($1) is not a function'
  | 'Right-hand side of "instanceof" ($1) is not an object'
  | 'Subclass constructor returned a smaller-than-requested object $1'
  | 'Subclass constructor returned the same object $1'
  | 'Super class $1 is not a constructor'
  | 'The "with" option in import() must be an object, but $1'
  | 'The RegExp passed to String.prototype.$1 must have the global flag'
  | 'The get property of the return value of an accessor decorator must be a function or undefined, but $1 was returned'
  | 'The init property of the return value of an accessor decorator must be a function or undefined, but $1 was returned'
  | 'The iterator $1 does not provide a throw method'
  | 'The second argument to import() must be an object, but $1'
  | 'The set property of the return value of an accessor decorator must be a function or undefined, but $1 was returned'
  | 'There is no $1 capture groups'
  | 'There is no capture group called $1'
  | 'Unable to freeze object $1'
  | 'Unable to prevent extensions on object $1'
  | 'Unable to seal object $1'
  | 'Unexpected $1'
  | 'Unexpected character $1 in JSON'
  | 'Unsupported import attribute "$1"'
  | 'Unsupported import attribute $1'
  | 'Variable $1 already declared'
  | 'addInitializer must be called with a function, but $1 was passed'
  | 'arguments[0] ($1) is not a symbol'
  | 'arguments[1] ($1) is not a function'
  | 'calendar must be a string, but $1'
  | 'calendarName option is invalid ($1), only "auto", "always", "never" and "critical" are accepted'
  | 'callbackfn ($1) is not a function'
  | 'comparator ($1) is not a function'
  | 'direction option is not valid ($1), only "next" and "previous" are accepted'
  | 'disambiguation option is invalid ($1), only "compatible", "earlier", "later" and "reject" are accepted'
  | 'heldValue $1 matches target'
  | 'invalid time zone identifier: $1'
  | 'mapper ($1) is not a function'
  | 'monthCode ($1) is not a string'
  | 'offset option is invalid ($1), only "auto" and "never" are accepted'
  | 'offset option is invalid ($1), only "prefer", "use", "ignore" and "reject" are accepted'
  | 'option $1 is required'
  | 'option.padding $1 is not an object'
  | 'options.padding $1 is not an object'
  | 'overflow option is invalid ($1), only "constrain" and "reject" are accepted'
  | 'stack property must be set to a string value, but got $1'
  | 'super ($1) is not a constructor'
  | 'targetOffset ($1) cannot be negative'
  | 'temporalCalendarLike must be a string or a Temporal object, but got $1'
  | 'this value $1 is not an object'
  | 'this.add ($1) is not a function'
  | 'timeZoneName option is invalid ($1), only "auto", "never" and "critical" are accepted'
  , $1: Formattable): ThrowCompletion;
  (m:
'"add" property ($1) of object $2 is not a function'
  | '"set" property ($1) of object $2 is not a function'
  | '$1 called on invalid receiver: $2'
  | '$1 does not exist on $2'
  | '$1 does not match any of productions ($2)'
  | '$1 is not a $2'
  | '$1 is not a $2 object'
  | 'Cannot create a proxy with a $1 as $2'
  | 'Cannot not delete property $1 on $2'
  | 'Cannot set property $1 on $2'
  | 'Expected $1 but got $2'
  | 'Expected character $1 but got $2 in JSON'
  | 'Export $1 from module "$2" is ambiguous'
  | 'Invalid range: $1 is bigger than $2'
  | 'Module "$1" does not have an export named $2'
  | 'Module $1 does not have an export named $2'
  | 'Object $1 does not have internal slot [[$2]]'
  | 'Private element $1 is already defined on $2'
  | 'Size of $1 should be a multiple of $2'
  | 'Start offset of $1 should be a multiple of $2'
  | 'The return value ($1) of the next() on an iterator ($2) must be an object'
  | 'The return value ($1) of the return() on an iterator ($2) must be an object'
  | 'The return value ($1) of the throw() on an iterator ($2) must be an object'
  | 'getter ($1) in a property descriptor $2 must be a function'
  | 'setter ($1) in a property descriptor $2 must be a function'
  , $1: Formattable, $2: Formattable): ThrowCompletion;
  (m:
'"roundingMode" on object $1 is not valid ($2), only $3 are accepted'
  | '$1 is not a function. (In "$2", it is $3)'
  | '$1-$2-$3 is not a valid ISO date'
  | '$1-$2-$3 is not a valid date'
  | 'Duration($1, $2, $3, $4) is not a valid duration'
  , $1: Formattable, $2: Formattable, $3: Formattable): ThrowCompletion;
  // auto-generate end
  <const S extends string>(m: S, ...args: ParsePrintFormat<S>): ThrowCompletion;
}

// thanks https://github.com/type-challenges/type-challenges/blob/main/questions/00147-hard-c-printf-parser/README.md
export type ParametersMap = {
  '1': Formattable;
  '2': Formattable;
  '3': Formattable;
  '4': Formattable;
  '5': Formattable;
}
export type ParsePrintFormat<S extends string> = S extends `${string}$${infer T}${infer End}` ? T extends keyof ParametersMap ? [ParametersMap[T], ...ParsePrintFormat<End>] : ParsePrintFormat<End> : []
