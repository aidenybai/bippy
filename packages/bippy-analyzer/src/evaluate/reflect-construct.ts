import type { SourceLocation } from "../parse/source-types.js";
import type { StaticValue } from "../types.js";
import { callWithArgumentList } from "./array-like.js";
import type { BuiltinEvaluator } from "./builtin-calls.js";
import { getConstructibility } from "./constructibility.js";
import type { EvaluationContext } from "./context.js";
import { createErrorValue, getIntrinsicConstructionError } from "./errors.js";
import {
  compareIdentity,
  distributeBinary,
  listValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
  primitiveValue,
} from "./values.js";

interface ReflectConstructEvaluator extends Pick<
  BuiltinEvaluator,
  "getProperty" | "callAlternatives" | "getRealm" | "construct" | "constructSuper"
> {}

const getReflectConstructError = (
  nativeArguments: unknown[] | null,
  location: SourceLocation | null,
): StaticValue => {
  let message: StaticValue = unknownPrimitiveValue(
    "string",
    "invalid Reflect.construct constructor",
  );
  if (nativeArguments) {
    try {
      Reflect.apply(Reflect.construct, Reflect, nativeArguments);
    } catch (error) {
      if (error instanceof Error) message = primitiveValue(error.message);
    }
  }
  return thrownValue(
    "invalid Reflect.construct constructor",
    createErrorValue("TypeError", [message], location),
    location,
  );
};

const constructorError = (value: StaticValue, location: SourceLocation | null): StaticValue =>
  getReflectConstructError(value.kind === "primitive" ? [value.value, []] : null, location);

export const reflectConstruct = (
  evaluator: ReflectConstructEvaluator,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const target = args[0] ?? UNDEFINED_VALUE;
  const hasNewTarget = args.length > 2;
  const newTarget = hasNewTarget ? (args[2] ?? UNDEFINED_VALUE) : target;
  const constructSelected = (
    selectedTarget: StaticValue,
    selectedNewTarget: StaticValue,
    selectedContext: EvaluationContext,
  ): StaticValue => {
    const realm = evaluator.getRealm(selectedContext.environment);
    const targetConstructibility = getConstructibility(selectedTarget, realm);
    if (targetConstructibility === false) return constructorError(selectedTarget, location);
    if (targetConstructibility === null)
      return unknownValue("Reflect.construct with a dynamic target", location);
    // HACK: V8 builds disagree on the error when the argument list is omitted.
    if (args.length < 2) return getReflectConstructError([Object], location);
    const newTargetConstructibility = getConstructibility(selectedNewTarget, realm);
    if (newTargetConstructibility === false) return constructorError(selectedNewTarget, location);
    if (newTargetConstructibility === null)
      return unknownValue("Reflect.construct with a dynamic new.target", location);
    return callWithArgumentList(
      evaluator,
      args[1] ?? UNDEFINED_VALUE,
      selectedContext,
      location,
      false,
      (constructArguments, argumentsContext) => {
        const constructionError =
          selectedTarget.kind === "global"
            ? getIntrinsicConstructionError(selectedTarget.name, location)
            : null;
        if (constructionError) return constructionError;
        const superConstructed =
          argumentsContext.thisValue &&
          evaluator.constructSuper(argumentsContext.thisValue, selectedTarget, constructArguments);
        if (superConstructed) return superConstructed;
        if (compareIdentity(selectedNewTarget, selectedTarget) !== true)
          return unknownValue("Reflect.construct with a foreign new.target", location);
        return evaluator.construct(selectedTarget, constructArguments, argumentsContext, location);
      },
    );
  };
  if (!hasNewTarget)
    return target.kind === "branch"
      ? evaluator.callAlternatives(target, context, (selectedTarget, selectedContext) =>
          constructSelected(selectedTarget, selectedTarget, selectedContext),
        )
      : constructSelected(target, target, context);
  if (target.kind !== "branch" && newTarget.kind !== "branch")
    return constructSelected(target, newTarget, context);
  const pairs = distributeBinary(target, newTarget, (selectedTarget, selectedNewTarget) =>
    listValue([selectedTarget, selectedNewTarget]),
  );
  if (!pairs)
    return unknownValue("Reflect.construct exceeds supported constructor alternatives", location);
  const constructPair = (pair: StaticValue, pairContext: EvaluationContext): StaticValue =>
    pair.kind === "list" ? constructSelected(pair.items[0], pair.items[1], pairContext) : pair;
  return pairs.kind === "branch"
    ? evaluator.callAlternatives(pairs, context, constructPair)
    : constructPair(pairs, context);
};
