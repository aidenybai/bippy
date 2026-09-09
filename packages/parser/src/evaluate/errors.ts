import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import {
  getObjectProperty,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
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

export const getErrorWitness = (value: StaticObjectValue): Error | null =>
  errorWitnesses.get(value) ?? null;
