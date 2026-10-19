import {
  assumeCondition,
  dedupeAbstractValues,
  evaluateCondition,
  getPossibleValues,
  hasUnknownPart,
  type Constraints,
} from "./constraints";
import type { AbstractValue, ConditionalValue, SymbolicValue } from "./types";
import { getTestExpression } from "./utils/get-test-expression";
import { getValueKey } from "./utils/get-value-key";

const getSideValues = (
  value: SymbolicValue,
  constraints: Constraints | null,
): AbstractValue[] | null => (constraints ? getSymbolicValues(value, constraints) : []);

const isNullish = (value: AbstractValue): boolean =>
  value.kind === "Literal"
    ? value.value === null || value.value === undefined
    : value.text === "undefined" || value.text === "null";

const isCoalescing = (value: ConditionalValue): boolean =>
  value.testKind === "nullish" && getValueKey(value.test) === getValueKey(value.consequent);

const getBranchValues = (
  value: ConditionalValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  const test = getTestExpression(value);
  const decided = evaluateCondition(test, constraints);
  if (decided !== null)
    return getSymbolicValues(decided ? value.consequent : value.alternate, constraints);
  const consequent = getSideValues(value.consequent, assumeCondition(test, true, constraints));
  const alternate = getSideValues(value.alternate, assumeCondition(test, false, constraints));
  if (!consequent || !alternate) return null;
  const kept = isCoalescing(value) ? consequent.filter((item) => !isNullish(item)) : consequent;
  return dedupeAbstractValues([...kept, ...alternate]);
};

export const getSymbolicValues = (
  value: SymbolicValue,
  constraints: Constraints,
): AbstractValue[] | null => {
  if (value.kind === "Primitive") return [{ kind: "Literal", value: value.value }];
  if (value.kind === "Conditional") return getBranchValues(value, constraints);
  return hasUnknownPart(value) ? null : getPossibleValues(value, constraints);
};
