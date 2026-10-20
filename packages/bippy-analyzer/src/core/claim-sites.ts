import { foldBinary } from "./symbolic-values";
import { describeCases } from "./claim-cases";
import { formatSymbolicValue } from "./format";
import type { AbstractValue, Claim, Domain, SourceLocation, SymbolicValue } from "./types";
import { getTestExpression } from "./utils/get-test-expression";
import { getValueKey } from "./utils/get-value-key";
import { isNullish } from "./utils/is-nullish";

export const CLAIM_FUNCTIONS = new Set(["invariant", "assert", "console.assert"]);

export const describeCondition = (value: SymbolicValue): string => {
  if (value.kind !== "Conditional") return formatSymbolicValue(value);
  const test = getTestExpression(value);
  if (getValueKey(value.consequent) === getValueKey(test))
    return `${describeCondition(test)} || ${describeCondition(value.alternate)}`;
  if (getValueKey(value.alternate) === getValueKey(test))
    return `${describeCondition(test)} && ${describeCondition(value.consequent)}`;
  return formatSymbolicValue(value);
};

type ClaimSite = Omit<Claim, "file" | "isInHandler">;

const isNullishCase = (value: AbstractValue): boolean =>
  value.kind === "Literal" && isNullish(value.value);

export const hasNullishCase = (domain: Domain): boolean =>
  domain.kind === "Cases" && domain.cases.some(isNullishCase);

const createNotNullishTest = (subject: SymbolicValue): SymbolicValue =>
  foldBinary("!=", subject, { kind: "Primitive", value: null });

export const createNonNullClaim = (
  subject: SymbolicValue,
  loc: SourceLocation,
  guards: SymbolicValue[],
): ClaimSite => ({
  kind: "non-null",
  subject,
  cases: null,
  test: createNotNullishTest(subject),
  guards,
  description: `${formatSymbolicValue(subject)}!`,
  loc,
});

const describeDomain = (domain: Domain): string | null => {
  if (domain.kind === "Cases") return describeCases(domain.cases);
  return domain.kind === "Opaque" ? domain.typeText : null;
};

export const createCastClaim = (
  subject: SymbolicValue,
  source: Domain,
  target: Domain,
  loc: SourceLocation,
  guards: SymbolicValue[],
): ClaimSite | null => {
  const targetText = describeDomain(target);
  if (targetText === null) return null;
  const description = `${formatSymbolicValue(subject)} as ${targetText}`;
  if (target.kind === "Cases" && target.cases.every((value) => value.kind === "Literal"))
    return { kind: "cast", subject, cases: target.cases, test: null, guards, description, loc };
  if (hasNullishCase(source) && !hasNullishCase(target))
    return {
      kind: "cast",
      subject,
      cases: null,
      test: createNotNullishTest(subject),
      guards,
      description,
      loc,
    };
  return null;
};
