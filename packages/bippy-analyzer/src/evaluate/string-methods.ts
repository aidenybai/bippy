import type { SourceLocation } from "../parse/source-types.js";
import type {
  StaticFunctionValue,
  StaticListValue,
  StaticRegExpValue,
  StaticValue,
} from "../types.js";
import type { EvaluationContext } from "./context.js";
import { getCoercedText } from "./primitive-shapes.js";
import {
  listValue,
  mapValue,
  NULL_VALUE,
  objectFromRecord,
  primitiveValue,
  regExpToString,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export interface StringMethodEvaluator {
  callFunction: (
    callback: StaticFunctionValue,
    argumentsList: StaticValue[],
    context: EvaluationContext,
  ) => StaticValue;
}

const toRegExp = (value: StaticRegExpValue): RegExp | null => {
  try {
    return new RegExp(value.pattern, value.flags);
  } catch {
    return null;
  }
};

const toPattern = (value: StaticValue): string | RegExp | null => {
  if (value.kind === "primitive") return String(value.value);
  if (value.kind === "regexp") return toRegExp(value);
  return null;
};

const listOfStrings = (parts: (string | undefined)[]): StaticListValue =>
  listValue(parts.map((part) => (part === undefined ? UNDEFINED_VALUE : primitiveValue(part))));

const matchResultValue = (matched: RegExpExecArray, input: string): StaticListValue => ({
  ...listOfStrings([...matched]),
  properties: new Map([
    ["index", primitiveValue(matched.index)],
    ["input", primitiveValue(input)],
    [
      "groups",
      matched.groups
        ? objectFromRecord(
            Object.fromEntries(
              Object.entries(matched.groups).map(([groupName, groupText]) => [
                groupName,
                groupText === undefined ? UNDEFINED_VALUE : primitiveValue(groupText),
              ]),
            ),
          )
        : UNDEFINED_VALUE,
    ],
  ]),
});

export const dynamicSplitResult = (location: SourceLocation | null): StaticListValue =>
  listValue([
    { kind: "repeat", item: unknownPrimitiveValue("string", "split of dynamic string"), location },
  ]);

/** `String.prototype.replace` with a callback needs the callback to produce a known string on every match. */
const replaceWithCallback = (
  evaluator: StringMethodEvaluator,
  receiver: string,
  pattern: string | RegExp,
  replacer: StaticFunctionValue,
  context: EvaluationContext,
  replaceAll: boolean,
): StaticValue | null => {
  let isKnown = true;
  const replaceMatch = (...matchArgs: (string | number)[]): string => {
    const result = evaluator.callFunction(
      replacer,
      matchArgs.map((matchArg) => primitiveValue(matchArg)),
      context,
    );
    if (result.kind === "primitive") return String(result.value);
    isKnown = false;
    return "";
  };
  const replaced = replaceAll
    ? receiver.replaceAll(pattern, replaceMatch)
    : receiver.replace(pattern, replaceMatch);
  return isKnown ? primitiveValue(replaced) : null;
};

const UNICODE_NORMALIZATION_FORMS = new Set(["NFC", "NFD", "NFKC", "NFKD"]);

export const callStringMethod = (
  evaluator: StringMethodEvaluator,
  receiver: string,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
): StaticValue | null => {
  const [first, second] = args;
  const primitiveArgs = args.map((argument) =>
    argument.kind === "primitive" ? argument.value : undefined,
  );
  const allKnown = args.every((argument) => argument.kind === "primitive");
  if (name === "split" || name === "replace" || name === "replaceAll") {
    const pattern = first ? toPattern(first) : null;
    if (pattern === null) return first ? null : listOfStrings([receiver]);
    if (name === "split") {
      const limit = second?.kind === "primitive" ? Number(second.value) : undefined;
      return listOfStrings(receiver.split(pattern, limit));
    }
    if (second?.kind === "function") {
      return replaceWithCallback(
        evaluator,
        receiver,
        pattern,
        second,
        context,
        name === "replaceAll",
      );
    }
    if (second?.kind !== "primitive") return null;
    const replacement = String(second.value);
    return primitiveValue(
      name === "replace"
        ? receiver.replace(pattern, replacement)
        : receiver.replaceAll(pattern, replacement),
    );
  }
  if (name === "match" && first?.kind === "regexp") {
    const regExp = toRegExp(first);
    if (!regExp) return null;
    if (regExp.global) {
      const matched = receiver.match(regExp);
      return matched ? listOfStrings([...matched]) : NULL_VALUE;
    }
    const matched = regExp.exec(receiver);
    return matched ? matchResultValue(matched, receiver) : NULL_VALUE;
  }
  if (name === "concat") {
    const texts = args.map(getCoercedText);
    return texts.every((text) => text !== null) ? primitiveValue(receiver + texts.join("")) : null;
  }
  if (name === "matchAll" && first?.kind === "regexp") {
    const regExp = toRegExp(first);
    if (!regExp?.global) return null;
    return listValue(
      [...receiver.matchAll(regExp)].map((matched) => matchResultValue(matched, receiver)),
    );
  }
  if (!allKnown) return null;
  const position = primitiveArgs[1] === undefined ? undefined : Number(primitiveArgs[1]);
  switch (name) {
    case "toUpperCase":
      return primitiveValue(receiver.toUpperCase());
    case "toLowerCase":
      return primitiveValue(receiver.toLowerCase());
    case "trim":
      return primitiveValue(receiver.trim());
    case "trimStart":
      return primitiveValue(receiver.trimStart());
    case "trimEnd":
      return primitiveValue(receiver.trimEnd());
    case "normalize": {
      const form = primitiveArgs[0] === undefined ? "NFC" : String(primitiveArgs[0]);
      return UNICODE_NORMALIZATION_FORMS.has(form)
        ? primitiveValue(receiver.normalize(form))
        : null;
    }
    case "slice":
    case "substring":
      return primitiveValue(
        name === "slice"
          ? receiver.slice(Number(primitiveArgs[0] ?? 0), position)
          : receiver.substring(Number(primitiveArgs[0] ?? 0), position),
      );
    case "substr":
      return primitiveValue(receiver.substr(Number(primitiveArgs[0] ?? 0), position));
    case "charAt":
      return primitiveValue(receiver.charAt(Number(primitiveArgs[0] ?? 0)));
    case "charCodeAt":
      return primitiveValue(receiver.charCodeAt(Number(primitiveArgs[0] ?? 0)));
    case "codePointAt": {
      const codePoint = receiver.codePointAt(Number(primitiveArgs[0] ?? 0));
      return codePoint === undefined ? UNDEFINED_VALUE : primitiveValue(codePoint);
    }
    case "at": {
      const character = receiver.at(Number(primitiveArgs[0] ?? 0));
      return character === undefined ? UNDEFINED_VALUE : primitiveValue(character);
    }
    case "indexOf":
      return primitiveValue(receiver.indexOf(String(primitiveArgs[0]), position));
    case "lastIndexOf":
      return primitiveValue(receiver.lastIndexOf(String(primitiveArgs[0]), position));
    case "padStart":
      return primitiveValue(
        receiver.padStart(Number(primitiveArgs[0] ?? 0), String(primitiveArgs[1] ?? " ")),
      );
    case "padEnd":
      return primitiveValue(
        receiver.padEnd(Number(primitiveArgs[0] ?? 0), String(primitiveArgs[1] ?? " ")),
      );
    case "includes":
      return primitiveValue(receiver.includes(String(primitiveArgs[0]), position));
    case "startsWith":
      return primitiveValue(receiver.startsWith(String(primitiveArgs[0]), position));
    case "endsWith":
      return primitiveValue(receiver.endsWith(String(primitiveArgs[0]), position));
    case "toString":
    case "valueOf":
      return primitiveValue(receiver);
    case "repeat":
      return primitiveValue(receiver.repeat(Number(primitiveArgs[0] ?? 0)));
    case "localeCompare":
      return primitiveValue(receiver.localeCompare(String(primitiveArgs[0])));
    default:
      return null;
  }
};

export const callNumberMethod = (
  receiver: number | boolean | bigint,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  const [first] = args;
  if (first !== undefined && first.kind !== "primitive") return null;
  const digits = first === undefined ? undefined : Number(first.value);
  switch (name) {
    case "toString":
      return primitiveValue(
        typeof receiver === "boolean" ? receiver.toString() : receiver.toString(digits),
      );
    case "valueOf":
      return primitiveValue(receiver);
    case "toFixed":
      return typeof receiver === "number" ? primitiveValue(receiver.toFixed(digits)) : null;
    case "toPrecision":
      return typeof receiver === "number" ? primitiveValue(receiver.toPrecision(digits)) : null;
    default:
      return null;
  }
};

export const callRegExpMethod = (
  receiver: StaticRegExpValue,
  name: string,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const [first] = args;
  const regExp = toRegExp(receiver);
  if (!regExp) return unknownValue(`invalid RegExp /${receiver.pattern}/`, location);
  if (name === "toString") return primitiveValue(regExpToString(receiver));
  if (name !== "test" && name !== "exec") return unknownValue(`RegExp.${name}()`, location);
  if (first?.kind === "branch" && !regExp.global && !regExp.sticky) {
    return mapValue(first, (alternative) =>
      callRegExpMethod(receiver, name, [alternative], location),
    );
  }
  if (first?.kind !== "primitive") {
    return name === "test"
      ? unknownPrimitiveValue("boolean", "RegExp.test() on a dynamic string")
      : unknownValue("RegExp.exec() on a dynamic string", location);
  }
  const input = String(first.value);
  regExp.lastIndex = receiver.lastIndex;
  const matched = regExp.exec(input);
  receiver.lastIndex = regExp.lastIndex;
  if (name === "test") return primitiveValue(matched !== null);
  return matched ? matchResultValue(matched, input) : NULL_VALUE;
};
