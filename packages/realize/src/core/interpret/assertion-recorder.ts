import { describeCases, withNullishCases } from "../type-checker/domains";
import { formatSymbolicValue } from "../values/format";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown, foldBinary, hasUnknownPart } from "../values/symbolic-values";
import type { Assertion, Domain, SourceLocation, SymbolicValue } from "../types";
import { forEachSymbolicValue } from "../values/for-each-symbolic-value";
import { getTestExpression } from "../values/get-test-expression";
import { getValueKey } from "../values/get-value-key";
import { getValuePlace } from "../values/get-value-place";
import { isNullishCase } from "../interpret/is-nullish-case";
import { getAssertionGuards, type WalkState } from "./walk-state";

const ASSERTION_FUNCTIONS = new Set(["invariant", "assert", "console.assert"]);

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

const createNonNullAssertion = (
  subject: SymbolicValue,
  loc: SourceLocation,
  guards: SymbolicValue[],
): Assertion => ({
  kind: "non-null",
  subject,
  check: { kind: "Condition", test: createNotNullishTest(subject) },
  guards,
  description: `${formatSymbolicValue(subject)}!`,
  loc,
});

const createCastAssertion = (
  subject: SymbolicValue,
  source: Domain,
  target: Domain,
  loc: SourceLocation,
  guards: SymbolicValue[],
): Assertion | null => {
  const targetText = describeDomain(target);
  if (targetText === null) return null;
  const description = `${formatSymbolicValue(subject)} as ${targetText}`;
  if (target.kind === "Cases" && target.cases.every((value) => value.kind === "Literal"))
    return {
      kind: "type",
      subject,
      check: { kind: "Membership", cases: target.cases },
      guards,
      description,
      loc,
    };
  if (hasNullishCase(source) && !hasNullishCase(target))
    return {
      kind: "type",
      subject,
      check: { kind: "Condition", test: createNotNullishTest(subject) },
      guards,
      description,
      loc,
    };
  return null;
};

export class AssertionRecorder {
  readonly #interpreter: Interpreter;
  readonly #assertions: Assertion[] = [];

  constructor(interpreter: Interpreter) {
    this.#interpreter = interpreter;
  }

  get assertions(): Assertion[] {
    return this.#assertions;
  }

  evaluateTypeCast(
    typeCast: InstructionValueOfKind<"TypeCastExpression">,
    walkState: WalkState,
  ): SymbolicValue {
    const castValue = this.#interpreter.read(typeCast.value);
    const sourceDomain = this.#interpreter.resolver.getDomain(typeCast.value.loc);
    const declaredSourceDomain = this.#interpreter.resolver.getTypeDomain(typeCast.value.loc);
    if (typeCast.typeAnnotationKind === "non-null") {
      if (hasNullishCase(declaredSourceDomain))
        this.record(createNonNullAssertion(castValue, typeCast.loc, getAssertionGuards(walkState)));
      return castValue;
    }
    const targetDomain = this.#interpreter.resolver.getDomain(typeCast.loc);
    const assertion = createCastAssertion(
      castValue,
      declaredSourceDomain,
      targetDomain,
      typeCast.loc,
      getAssertionGuards(walkState),
    );
    if (assertion) this.record(this.#widenForNonStrictNulls(assertion));
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
    if (name === null || !ASSERTION_FUNCTIONS.has(name) || test === undefined) return;
    this.record({
      kind: "call",
      subject: test,
      check: { kind: "Condition", test },
      guards: getAssertionGuards(walkState),
      description: `${name}(${describeCondition(test)})`,
      loc,
    });
  }

  record(assertion: Assertion): void {
    if (assertion.kind !== "call" && !this.#isCheckable(assertion.subject)) return;
    const handlerEffects = this.#interpreter.handlerEffects;
    if (handlerEffects) {
      handlerEffects.addAssertion(assertion);
      return;
    }
    this.#assertions.push(assertion);
  }

  #widenForNonStrictNulls(assertion: Assertion): Assertion {
    if (this.#interpreter.resolver.isStrictNullChecks || assertion.check.kind !== "Membership")
      return assertion;
    return {
      ...assertion,
      check: { kind: "Membership", cases: withNullishCases(assertion.check.cases) },
    };
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
