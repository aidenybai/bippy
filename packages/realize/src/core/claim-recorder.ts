import { hasUnknownPart } from "./constraints";
import { describeCases, withNullishCases } from "./domains";
import { formatSymbolicValue } from "./format";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown, foldBinary } from "./symbolic-values";
import type { Claim, Domain, SourceLocation, SymbolicValue } from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getTestExpression } from "./utils/get-test-expression";
import { getValueKey } from "./utils/get-value-key";
import { getValuePlace } from "./utils/get-value-place";
import { isNullishCase } from "./utils/is-nullish-case";
import { getClaimGuards, type WalkState } from "./walk-state";

const CLAIM_FUNCTIONS = new Set(["invariant", "assert", "console.assert"]);

const describeCondition = (value: SymbolicValue): string => {
  if (value.kind !== "Conditional") return formatSymbolicValue(value);
  const test = getTestExpression(value);
  if (getValueKey(value.consequent) === getValueKey(test))
    return `${describeCondition(test)} || ${describeCondition(value.alternate)}`;
  if (getValueKey(value.alternate) === getValueKey(test))
    return `${describeCondition(test)} && ${describeCondition(value.consequent)}`;
  return formatSymbolicValue(value);
};

const hasNullishCase = (domain: Domain): boolean =>
  domain.kind === "Cases" && domain.cases.some(isNullishCase);

const isLiteralDomain = (domain: Domain): boolean =>
  domain.kind === "Cases" && domain.cases.every((value) => value.kind === "Literal");

const describeDomain = (domain: Domain): string | null => {
  if (domain.kind === "Cases") return describeCases(domain.cases);
  return domain.kind === "Opaque" ? domain.typeText : null;
};

const createNotNullishTest = (subject: SymbolicValue): SymbolicValue =>
  foldBinary("!=", subject, { kind: "Primitive", value: null });

const createNonNullClaim = (
  subject: SymbolicValue,
  loc: SourceLocation,
  guards: SymbolicValue[],
): Claim => ({
  kind: "non-null",
  subject,
  cases: null,
  test: createNotNullishTest(subject),
  guards,
  description: `${formatSymbolicValue(subject)}!`,
  loc,
});

const createCastClaim = (
  subject: SymbolicValue,
  source: Domain,
  target: Domain,
  loc: SourceLocation,
  guards: SymbolicValue[],
): Claim | null => {
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

export class ClaimRecorder {
  readonly #interpreter: Interpreter;
  readonly #claims: Claim[] = [];

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  get claims(): Claim[] {
    return this.#claims;
  }

  evaluateTypeCast(
    typeCast: InstructionValueOfKind<"TypeCastExpression">,
    walkState: WalkState,
  ): SymbolicValue {
    const castValue = this.#interpreter.read(typeCast.value);
    const { resolver } = this.#interpreter;
    const sourceDomain = resolver.getDomain(typeCast.value.loc);
    const declaredSourceDomain = resolver.getTypeDomain(typeCast.value.loc);
    if (typeCast.typeAnnotationKind === "non-null") {
      if (hasNullishCase(declaredSourceDomain))
        this.record(createNonNullClaim(castValue, typeCast.loc, getClaimGuards(walkState)));
      return castValue;
    }
    const targetDomain = resolver.getDomain(typeCast.loc);
    const claim = createCastClaim(
      castValue,
      declaredSourceDomain,
      targetDomain,
      typeCast.loc,
      getClaimGuards(walkState),
    );
    if (claim) this.record(this.#widenForNonStrictNulls(claim));
    const isUntypedCast = castValue.kind === "Unknown" && sourceDomain.kind === "Unknown";
    const isNarrowingCast =
      castValue.kind !== "Primitive" &&
      !isLiteralDomain(sourceDomain) &&
      isLiteralDomain(targetDomain);
    return isUntypedCast || isNarrowingCast ? createUnknown("cast", typeCast.value.loc) : castValue;
  }

  recordInvariant(
    name: string | null,
    argumentValues: SymbolicValue[],
    loc: SourceLocation,
    walkState: WalkState,
  ): void {
    const [test] = argumentValues;
    if (name === null || !CLAIM_FUNCTIONS.has(name) || test === undefined) return;
    this.record({
      kind: "invariant",
      subject: test,
      cases: null,
      test,
      guards: getClaimGuards(walkState),
      description: `${name}(${describeCondition(test)})`,
      loc,
    });
  }

  record(claim: Claim): void {
    if (claim.kind !== "invariant" && !this.#isCheckable(claim.subject)) return;
    const handlerEffects = this.#interpreter.handlerEffects;
    if (handlerEffects) {
      handlerEffects.addClaim(claim);
      return;
    }
    this.#claims.push(claim);
  }

  #widenForNonStrictNulls(claim: Claim): Claim {
    if (this.#interpreter.resolver.isStrictNullChecks || !claim.cases) return claim;
    return { ...claim, cases: withNullishCases(claim.cases) };
  }

  #isCheckable(value: SymbolicValue): boolean {
    if (hasUnknownPart(value)) return false;
    let isCheckable = true;
    forEachSymbolicValue(value, (part) => {
      if (part.kind !== "Binding") return;
      if (part.binding.kind === "ref") isCheckable = false;
      const domain =
        this.#interpreter.bindingTable.placeDomains.get(getValuePlace(part)) ??
        (part.path.length === 0 ? part.binding.domain : undefined);
      if (domain?.kind !== "Cases" && domain?.kind !== "Opaque") isCheckable = false;
    });
    return isCheckable;
  }
}
