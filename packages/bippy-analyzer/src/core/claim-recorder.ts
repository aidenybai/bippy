import type { SourceLocation } from "../react-compiler/HIR/HIR";
import {
  CLAIM_FUNCTIONS,
  createCastClaim,
  createNonNullClaim,
  describeCondition,
  hasNullishCase,
} from "./claim-sites";
import { withNullishCases } from "./claim-cases";
import { hasUnknownPart } from "./constraints";
import type { InstructionValueOfKind, Interpreter } from "./interpret";
import { createUnknown } from "./symbolic-values";
import type { Claim, Domain, SymbolicValue } from "./types";

type ClaimSite = Omit<Claim, "file" | "isInHandler">;
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";
import { getValuePlace } from "./utils/get-value-place";
import { getClaimGuards, type WalkState } from "./walk-state";

const isLiteralDomain = (domain: Domain): boolean =>
  domain.kind === "Cases" && domain.cases.every((value) => value.kind === "Literal");

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

  #widenForNonStrictNulls(claim: ClaimSite): ClaimSite {
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

  record(claim: ClaimSite): void {
    if (claim.kind === "invariant" || this.#isCheckable(claim.subject))
      this.#claims.push({
        ...claim,
        file: this.#interpreter.resolver.fileName,
        isInHandler: this.#interpreter.handlerEffects !== null,
      });
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
}
