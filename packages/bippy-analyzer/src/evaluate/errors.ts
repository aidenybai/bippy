import type { SourceLocation } from "../parse/source-types.js";
import type { StaticObjectValue, StaticValue } from "../types.js";
import {
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const ERROR_CONSTRUCTORS = {
  Error,
  TypeError,
  RangeError,
  SyntaxError,
  ReferenceError,
  EvalError,
  URIError,
};

type ErrorConstructorName = keyof typeof ERROR_CONSTRUCTORS;

/** A runtime instance with the same prototype chain as each modeled error object, for `instanceof`. */
const errorWitnesses = new WeakMap<StaticObjectValue, Error>();

export const isErrorConstructorName = (name: string): name is ErrorConstructorName =>
  Object.hasOwn(ERROR_CONSTRUCTORS, name);

const toMessage = (message: StaticValue | undefined): StaticValue => {
  if (message === undefined || (message.kind === "primitive" && message.value === undefined))
    return primitiveValue("");
  if (message.kind === "primitive") return primitiveValue(String(message.value));
  return unknownPrimitiveValue("string", "error message from a dynamic value");
};

/** `new Error(message, options)` (also called without `new`); `stack` depends on the engine. */
export const createErrorValue = (
  name: ErrorConstructorName,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticObjectValue => {
  const [message, options] = args;
  const cause = options?.kind === "object" ? getObjectProperty(options, "cause") : UNDEFINED_VALUE;
  const error = objectFromRecord({
    name: primitiveValue(name),
    message: toMessage(message),
    stack: unknownPrimitiveValue(
      "string",
      `${name} stack${location ? ` at ${location.filePath}:${location.line}` : ""}`,
    ),
    ...(cause.kind === "primitive" && cause.value === undefined ? {} : { cause }),
  });
  errorWitnesses.set(error, new ERROR_CONSTRUCTORS[name]());
  return error;
};

export const createTypeError = (reason: string, location: SourceLocation | null): StaticValue =>
  thrownValue(
    reason,
    createErrorValue("TypeError", [unknownPrimitiveValue("string", reason)], location),
    location,
  );

export const createNonConstructorError = (
  location: SourceLocation | null,
  reason = "non-constructible value",
): StaticValue => createTypeError(reason, location);

export const getIntrinsicConstructionError = (
  name: string,
  location: SourceLocation | null,
): StaticValue | null =>
  name === "Symbol" || name === "BigInt"
    ? thrownValue(
        `${name} cannot be constructed`,
        createErrorValue("TypeError", [primitiveValue(`${name} is not a constructor`)], location),
        location,
      )
    : null;

export const getErrorWitness = (value: StaticObjectValue): Error | null =>
  errorWitnesses.get(value) ?? null;

const isStringablePrimitive = (value: StaticValue): boolean =>
  value.kind === "primitive"
    ? typeof value.value !== "symbol"
    : value.kind === "unknown-primitive" && value.primitiveType !== "any";

/** `Error.prototype.toString` over the `name` and `message` the receiver reads back. */
export const getErrorText = (errorName: StaticValue, message: StaticValue): StaticValue => {
  if (!isStringablePrimitive(errorName) || !isStringablePrimitive(message))
    return unknownValue("Error.prototype.toString of an unmodeled name or message");
  return errorName.kind === "primitive" && message.kind === "primitive"
    ? primitiveValue(
        Error.prototype.toString.call({ name: errorName.value, message: message.value }),
      )
    : unknownPrimitiveValue("string", "Error.prototype.toString of a dynamic name or message");
};
